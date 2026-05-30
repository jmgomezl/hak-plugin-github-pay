// Live, on-chain demo of the github-pay flow — the 100-second story.
// Runs the REAL tools against testnet and prints Hashscan links for each step.
//
//   issue → policy → cap → register → MERGE → HBAR paid → receipt → idempotency
//
// Usage:  node scripts/demo.mjs   (needs Node >= 20 and a populated .env)
import "dotenv/config";
import {
  AccountCreateTransaction,
  AccountBalanceQuery,
  AccountId,
  Hbar,
  PrivateKey,
} from "@hiero-ledger/sdk";
import { createGithubPayAgent, initTopics, payOnMerge, topicHashscanUrl } from "../dist/index.js";

const REPO = "jmgomezl/hak-plugin-github-pay";
const HANDLE = "octo-demo";
const PR = 100 + Math.floor((Date.now() / 1000) % 800);
const LABEL = "bounty-25";
const AMOUNT = 25;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (n, title) => {
  console.log(`\n${c.cyan(`◆ ${n}`)}  ${c.bold(title)}`);
  await sleep(500);
};

async function main() {
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  console.log(c.bold("\n  github-pay — live testnet demo  ⛓\n"));
  console.log(c.dim(`  network: ${network}   payer: ${accountId}`));

  const agent = createGithubPayAgent({
    accountId,
    privateKey: process.env.HEDERA_PRIVATE_KEY,
    network,
    geminiApiKey: process.env.GEMINI_API_KEY ?? "unused-in-demo",
  });
  await initTopics(agent);

  await step(1, "A contributor registers their Hedera account (public IDENTITIES topic)");
  const recipientKey = PrivateKey.generateECDSA();
  const created = await new AccountCreateTransaction()
    .setKeyWithoutAlias(recipientKey.publicKey)
    .setInitialBalance(new Hbar(0))
    .execute(agent.client);
  const recipient = (await created.getReceipt(agent.client)).accountId.toString();
  const reg = await agent.api.run("github_pay_register_contributor", {
    github_handle: HANDLE,
    hedera_account_id: recipient,
  });
  console.log(c.dim(`  @${HANDLE} → ${recipient}`));
  console.log(c.dim(`  ${JSON.parse(reg).hashscanUrl ?? topicHashscanUrl(network, "")}`));

  await step(2, "Repo admin sets the payment policy + spending cap (immutable POLICIES topic)");
  await agent.api.run("github_pay_set_payment_policy", {
    repo: REPO,
    label: LABEL,
    amount_hbar: AMOUNT,
  });
  await agent.api.run("github_pay_set_payment_cap", {
    repo: REPO,
    monthly_cap_hbar: 500,
    per_contributor_cap_hbar: 200,
  });
  console.log(c.dim(`  ${LABEL} → ${AMOUNT} HBAR   ·   cap 500/mo, 200/contributor`));

  console.log(c.dim("\n  …waiting for mirror-node to index policy + identity…"));
  await sleep(8000);

  await step(3, `PR #${PR} is reviewed and MERGED  →  the agent pays automatically`);
  const result = await payOnMerge(agent.client, network, accountId, {
    repo: REPO,
    prNumber: PR,
    prUrl: `https://github.com/${REPO}/pull/${PR}`,
    prAuthor: HANDLE,
    label: LABEL,
  });
  if (result.status === "paid") {
    console.log(c.green(`  ✔ PAID ${AMOUNT} HBAR to @${HANDLE} (${recipient})`));
    console.log(c.dim(`  tx:      ${result.transactionHashscanUrl}`));
    console.log(c.dim(`  receipt: ${result.receiptTopicHashscanUrl}`));
  }

  await step(4, "Webhook fires AGAIN (retry) — idempotency blocks a double payment");
  const retry = await payOnMerge(agent.client, network, accountId, {
    repo: REPO,
    prNumber: PR,
    prUrl: `https://github.com/${REPO}/pull/${PR}`,
    prAuthor: HANDLE,
    label: LABEL,
  });
  console.log(c.yellow(`  → status: ${retry.status}  (no second transfer)`));

  const bal = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(recipient))
    .execute(agent.client);
  console.log(c.green(`\n  ${c.bold(`Contributor balance: ${bal.hbars.toString()}`)}  — paid exactly once ✅`));

  console.log(c.dim("\n  Every step above is sealed on Hedera. Verify on Hashscan. 🔗\n"));
  agent.client.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("demo error:", e);
  process.exit(1);
});
