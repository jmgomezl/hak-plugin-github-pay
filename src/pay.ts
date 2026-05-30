import {
  Client,
  TransferTransaction,
  Hbar,
  AccountId,
} from "@hiero-ledger/sdk";
import { createHash } from "crypto";
import {
  submitMessage,
  hashscanBase,
  recordOperation,
  isPrPaidLocally,
  markPrPaidLocally,
} from "./hcs.js";
import {
  resolveContributor,
  resolvePolicyRule,
  resolveCap,
  getAllReceipts,
  findReceiptForPr,
  monthlySpend,
  contributorMonthlySpend,
} from "./resolve.js";
import type { Receipt, ReleaseProvenance } from "./types.js";

export type PayOnMergeInput = {
  repo: string;
  prNumber: number;
  prUrl: string;
  prAuthor: string; // GitHub handle
  label: string;
};

// In-flight lock: guards two payOnMerge calls for the same PR that race past the
// persisted guard before either has marked it (the check and the transfer are
// separated by awaits). Single-process, complements the store.json guard.
const inFlight = new Set<string>();

export type PayOnMergeResult =
  | {
      status: "paid";
      receipt: Receipt;
      sequenceNumber: string;
      transactionHashscanUrl: string;
      receiptTopicHashscanUrl: string;
    }
  | { status: "already_paid"; receipt: Receipt }
  | { status: "skipped"; reason: string };

/**
 * The core enterprise flow. Reads policy + identity + caps from HCS, enforces
 * idempotency on the PR number, executes the HBAR transfer, and seals a receipt.
 *
 * The financial controls live entirely on-chain: the POLICIES cap is the spend
 * ceiling, the RECEIPTS topic is the dedup key, and the GitHub PR merge is the
 * human approval. No additional sign-off is performed here by design.
 */
export async function payOnMerge(
  client: Client,
  network: string,
  payerAccountId: string,
  input: PayOnMergeInput,
  notify?: (r: Extract<PayOnMergeResult, { status: "paid" }>) => Promise<void>
): Promise<PayOnMergeResult> {
  const lockKey = `${input.repo}#${input.prNumber}`;
  if (inFlight.has(lockKey)) {
    return {
      status: "skipped",
      reason: `A payment for ${lockKey} is already being processed (concurrent retry). No second payment.`,
    };
  }
  inFlight.add(lockKey);
  try {
    return await payOnMergeInner(client, network, payerAccountId, input, notify);
  } finally {
    inFlight.delete(lockKey);
  }
}

async function payOnMergeInner(
  client: Client,
  network: string,
  payerAccountId: string,
  input: PayOnMergeInput,
  notify?: (r: Extract<PayOnMergeResult, { status: "paid" }>) => Promise<void>
): Promise<PayOnMergeResult> {
  // 1. Policy lookup — what does this label pay?
  const rule = await resolvePolicyRule(network, input.repo, input.label);
  if (!rule) {
    return {
      status: "skipped",
      reason: `No payment policy found for label "${input.label}" on ${input.repo}. Nothing to pay.`,
    };
  }

  // 2. Idempotency. Two layers:
  //    (a) local guard — instant, closes the mirror-node lag window on rapid retries;
  //    (b) RECEIPTS topic — durable source of truth across hosts/redeploys.
  if (isPrPaidLocally(input.repo, input.prNumber)) {
    const existing = await findReceiptForPr(network, input.repo, input.prNumber);
    if (existing) return { status: "already_paid", receipt: existing };
    // Sealed locally but mirror hasn't indexed the receipt yet — still a dup.
    return {
      status: "skipped",
      reason: `PR ${input.repo}#${input.prNumber} was already paid in this deployment (receipt pending mirror indexing). No second payment.`,
    };
  }
  const existing = await findReceiptForPr(network, input.repo, input.prNumber);
  if (existing) {
    markPrPaidLocally(input.repo, input.prNumber);
    return { status: "already_paid", receipt: existing };
  }

  // 3. Identity resolution — GitHub handle → Hedera account via the IDENTITIES topic.
  const account = await resolveContributor(network, input.prAuthor);
  if (!account) {
    return {
      status: "skipped",
      reason: `Contributor "${input.prAuthor}" has not registered a Hedera account on the IDENTITIES topic. Ask them to run register_contributor.`,
    };
  }

  // 4. Spending caps — enterprise financial control, enforced from the POLICIES topic.
  const cap = await resolveCap(network, input.repo);
  if (cap) {
    const receipts = await getAllReceipts(network);
    const now = new Date();
    const repoSpent = monthlySpend(receipts, input.repo, now);
    const contribSpent = contributorMonthlySpend(receipts, input.repo, account, now);

    if (repoSpent + rule.amountHbar > cap.monthlyCapHbar) {
      return {
        status: "skipped",
        reason: `Monthly cap exceeded for ${input.repo}: ${repoSpent} + ${rule.amountHbar} HBAR would exceed the ${cap.monthlyCapHbar} HBAR ceiling. Payment blocked.`,
      };
    }
    if (contribSpent + rule.amountHbar > cap.perContributorCapHbar) {
      return {
        status: "skipped",
        reason: `Per-contributor cap exceeded for ${input.prAuthor}: ${contribSpent} + ${rule.amountHbar} HBAR would exceed the ${cap.perContributorCapHbar} HBAR ceiling. Payment blocked.`,
      };
    }
  }

  // 5. Execute the transfer.
  const amount = new Hbar(rule.amountHbar);
  const tx = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(payerAccountId), amount.negated())
    .addHbarTransfer(AccountId.fromString(account), amount)
    .setTransactionMemo(`github-pay ${input.repo}#${input.prNumber} ${input.label}`.slice(0, 100));

  const submit = await tx.execute(client);
  await submit.getReceipt(client); // throws on failure
  const transactionId = submit.transactionId.toString();

  // Mark paid locally the instant the transfer settles, before sealing the
  // receipt — a concurrent retry now hits the local guard, never a 2nd transfer.
  markPrPaidLocally(input.repo, input.prNumber);

  // 6. Seal the receipt on the RECEIPTS topic.
  const receipt: Receipt = {
    kind: "receipt",
    repo: input.repo,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    githubHandle: input.prAuthor.replace(/^@/, ""),
    hederaAccountId: account,
    amountHbar: rule.amountHbar,
    label: input.label,
    transactionId,
    timestamp: new Date().toISOString(),
  };
  const seal = await submitMessage(client, network, "RECEIPTS", receipt);
  recordOperation("pay_on_merge", `${input.repo}#${input.prNumber} → ${rule.amountHbar} HBAR to ${account}`);

  const result: Extract<PayOnMergeResult, { status: "paid" }> = {
    status: "paid",
    receipt,
    sequenceNumber: seal.sequenceNumber,
    transactionHashscanUrl: `${hashscanBase(network)}/transaction/${encodeURIComponent(transactionId)}`,
    receiptTopicHashscanUrl: seal.hashscanUrl,
  };

  if (notify) {
    try {
      await notify(result);
    } catch {
      // notifications are best-effort; never fail a payment because Slack is down
    }
  }

  return result;
}

// ─── seal_release_provenance ──────────────────────────────────────────────────

export type ReleaseInput = {
  repo: string;
  tag: string;
  commitSha: string;
  assetUrls: string[];
};

export async function sealReleaseProvenance(
  client: Client,
  network: string,
  payerAccountId: string,
  input: ReleaseInput,
  githubToken?: string
): Promise<{ provenance: ReleaseProvenance; sequenceNumber: string; hashscanUrl: string }> {
  const assetHashes: ReleaseProvenance["assetHashes"] = [];

  for (const url of input.assetUrls) {
    const headers: Record<string, string> = { "User-Agent": "github-pay" };
    // GitHub release asset API URLs need the octet-stream accept header to get bytes.
    headers["Accept"] = "application/octet-stream";
    if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;

    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) throw new Error(`Failed to fetch asset ${url}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const name = decodeURIComponent(url.split("/").pop() ?? url);
    assetHashes.push({ name, sha256, sizeBytes: buf.length });
  }

  const provenance: ReleaseProvenance = {
    kind: "release_provenance",
    repo: input.repo,
    tag: input.tag,
    commitSha: input.commitSha,
    assetHashes,
    payerAccount: payerAccountId,
    timestamp: new Date().toISOString(),
  };

  const seal = await submitMessage(client, network, "RELEASES", provenance);
  recordOperation("seal_release_provenance", `${input.repo}@${input.tag} (${assetHashes.length} assets)`);

  return {
    provenance,
    sequenceNumber: seal.sequenceNumber,
    hashscanUrl: seal.hashscanUrl,
  };
}

// ─── Slack/Teams outbound notification (nice-to-have) ─────────────────────────

export async function notifySlack(
  webhookUrl: string,
  paid: Extract<PayOnMergeResult, { status: "paid" }>
): Promise<void> {
  const r = paid.receipt;
  const text = [
    `:moneybag: *Bounty paid* — ${r.amountHbar} HBAR`,
    `• PR: <${r.prUrl}|${r.repo}#${r.prNumber}> (\`${r.label}\`)`,
    `• Contributor: \`@${r.githubHandle}\` → \`${r.hederaAccountId}\``,
    `• Receipt: <${paid.receiptTopicHashscanUrl}|HCS topic> · <${paid.transactionHashscanUrl}|transaction>`,
  ].join("\n");

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
