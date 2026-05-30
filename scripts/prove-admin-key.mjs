// Proof: the POLICIES topic is locked with a dedicated admin key (submitKey),
// so the PAYER key alone cannot write payment rules or raise its own cap.
//
// 1. Re-provision a fresh POLICIES topic with submitKey = POLICY_ADMIN_KEY.
// 2. Admin-signed policy write  → SUCCEEDS.
// 3. Payer-key-only policy write → REJECTED (INVALID_SIGNATURE).
import "dotenv/config";
import { TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import {
  createGithubPayAgent,
  getTopicId,
  initTopics,
  loadStore,
  saveStore,
} from "../dist/index.js";

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const d = (s) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const adminKey = process.env.POLICY_ADMIN_KEY;
  if (!adminKey) throw new Error("POLICY_ADMIN_KEY is not set");

  // Force a fresh POLICIES topic so the submitKey is applied at creation.
  const store = loadStore();
  store.topics.POLICIES = null;
  saveStore(store);

  const agent = createGithubPayAgent({
    accountId,
    privateKey: process.env.HEDERA_PRIVATE_KEY,
    network,
    geminiApiKey: "unused",
    policyAdminKey: adminKey,
  });

  console.log("\n  Provisioning a POLICIES topic locked with a dedicated admin key…");
  await initTopics(agent);
  const policiesTopic = getTopicId("POLICIES");
  console.log(d(`  POLICIES topic: ${policiesTopic}  (submitKey = admin key, NOT the payer key)`));

  // (2) Admin-signed write via the tool — should succeed.
  console.log("\n  [A] Admin-signed policy write …");
  const res = await agent.api.run("github_pay_set_payment_policy", {
    repo: "jmgomezl/hak-plugin-github-pay",
    label: "bounty-25",
    amount_hbar: 25,
  });
  const seq = JSON.parse(res).sequenceNumber;
  console.log(g(`      ✔ ACCEPTED — sealed on POLICIES (seq ${seq})`));

  // (3) Payer-key-only write (no admin signature) — should be rejected on-chain.
  console.log("\n  [B] Payer-key-only write (attacker tries to raise the cap) …");
  try {
    await (
      await new TopicMessageSubmitTransaction()
        .setTopicId(policiesTopic)
        .setMessage(
          JSON.stringify({
            kind: "payment_cap",
            repo: "jmgomezl/hak-plugin-github-pay",
            monthlyCapHbar: 1000000,
            perContributorCapHbar: 1000000,
            timestamp: new Date().toISOString(),
          }),
        )
        .execute(agent.client)
    ) // signed only by the operator/payer key
      .getReceipt(agent.client);
    console.log(r("      ✗ UNEXPECTED — payer key was able to write to POLICIES"));
    process.exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/INVALID_SIGNATURE/.test(msg)) {
      console.log(
        g("      ✔ REJECTED with INVALID_SIGNATURE — payer key cannot raise its own cap ✅"),
      );
    } else {
      console.log(r(`      ? rejected, but not with INVALID_SIGNATURE: ${msg}`));
      process.exitCode = 1;
    }
  }

  console.log(
    d(`\n  POLICIES is now ${policiesTopic} — financial control is enforced on-chain.\n`),
  );
  agent.client.close();
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error("proof error:", e);
  process.exit(1);
});
