import { getTopicId, readTopicMessages } from "./hcs.js";
import type { IdentityRecord, PaymentCap, PolicyRule, Receipt } from "./types.js";

// These helpers read the immutable HCS topics through the mirror node and
// fold them into the "current" view. The topics are the source of truth — there
// is no database. Later messages override earlier ones for the same key.

export async function resolveContributor(
  network: string,
  githubHandle: string,
): Promise<string | null> {
  const records = await readTopicMessages<IdentityRecord>(network, getTopicId("IDENTITIES"));
  let account: string | null = null;
  for (const r of records) {
    if (r.kind === "identity" && eqHandle(r.githubHandle, githubHandle)) {
      account = r.hederaAccountId; // last write wins
    }
  }
  return account;
}

export async function resolveHandleByAccount(
  network: string,
  hederaAccountId: string,
): Promise<string | null> {
  const records = await readTopicMessages<IdentityRecord>(network, getTopicId("IDENTITIES"));
  let handle: string | null = null;
  for (const r of records) {
    if (r.kind === "identity" && r.hederaAccountId === hederaAccountId) {
      handle = r.githubHandle;
    }
  }
  return handle;
}

/** Resolve the active payment amount for a (repo, label) pair. Last write wins. */
export async function resolvePolicyRule(
  network: string,
  repo: string,
  label: string,
): Promise<PolicyRule | null> {
  const rules = await readTopicMessages<PolicyRule>(network, getTopicId("POLICIES"));
  let match: PolicyRule | null = null;
  for (const r of rules) {
    if (r.kind === "policy_rule" && r.repo === repo && r.label === label) {
      match = r;
    }
  }
  return match;
}

/** Resolve the active spending cap for a repo. Last write wins. */
export async function resolveCap(network: string, repo: string): Promise<PaymentCap | null> {
  const caps = await readTopicMessages<PaymentCap>(network, getTopicId("POLICIES"));
  let match: PaymentCap | null = null;
  for (const c of caps) {
    if (c.kind === "payment_cap" && c.repo === repo) {
      match = c;
    }
  }
  return match;
}

export async function getAllReceipts(network: string): Promise<Receipt[]> {
  const msgs = await readTopicMessages<Receipt>(network, getTopicId("RECEIPTS"));
  return msgs.filter((m) => m.kind === "receipt");
}

/** Idempotency check: has this (repo, prNumber) already been paid? */
export async function findReceiptForPr(
  network: string,
  repo: string,
  prNumber: number,
): Promise<Receipt | null> {
  const receipts = await getAllReceipts(network);
  return receipts.find((r) => r.repo === repo && r.prNumber === prNumber) ?? null;
}

/** Total HBAR paid this calendar month for a repo (cap enforcement). */
export function monthlySpend(receipts: Receipt[], repo: string, now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return receipts
    .filter((r) => r.repo === repo)
    .filter((r) => {
      const d = new Date(r.timestamp);
      return d.getUTCFullYear() === y && d.getUTCMonth() === m;
    })
    .reduce((sum, r) => sum + r.amountHbar, 0);
}

/** Total HBAR paid this calendar month to a single contributor (cap enforcement). */
export function contributorMonthlySpend(
  receipts: Receipt[],
  repo: string,
  hederaAccountId: string,
  now: Date,
): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return receipts
    .filter((r) => r.repo === repo && r.hederaAccountId === hederaAccountId)
    .filter((r) => {
      const d = new Date(r.timestamp);
      return d.getUTCFullYear() === y && d.getUTCMonth() === m;
    })
    .reduce((sum, r) => sum + r.amountHbar, 0);
}

function eqHandle(a: string, b: string): boolean {
  return a.replace(/^@/, "").toLowerCase() === b.replace(/^@/, "").toLowerCase();
}
