# Examples

## Run the app

```bash
cp .env.example .env   # fill in HEDERA_*, GEMINI_API_KEY, GITHUB_WEBHOOK_SECRET
npm install
npm run build
npm start              # provisions topics, starts webhook server + agent REPL
```

> Requires Node ≥ 20 — the Hedera SDK fails silently on Node 18.

## Drive the agent (REPL)

```
github-pay > register @octocat as 0.0.654321
github-pay > set a policy: label bounty-50 pays 50 HBAR on jmgomezl/demo-repo
github-pay > set a cap of 500 HBAR/month and 200 per contributor on jmgomezl/demo-repo
github-pay > show me octocat's payment history
```

## Embed the plugin in your own HAK agent

```ts
import { HederaAgentAPI } from "@hashgraph/hedera-agent-kit";
import { githubPayPlugin } from "@jmgomezl/github-pay";

const context = { accountId: operatorId, config: { githubPay: { network: "testnet" } } };
const tools = githubPayPlugin.tools(context);
const api = new HederaAgentAPI(client, context, tools);

await api.run("github_pay_register_contributor", {
  github_handle: "octocat",
  hedera_account_id: "0.0.654321",
});
```

## Call the domain logic directly (no agent loop)

```ts
import { payOnMerge } from "@jmgomezl/github-pay";

const result = await payOnMerge(client, "testnet", payerAccountId, {
  repo: "jmgomezl/demo-repo",
  prNumber: 42,
  prUrl: "https://github.com/jmgomezl/demo-repo/pull/42",
  prAuthor: "octocat",
  label: "bounty-50",
});
// result.status: "paid" | "already_paid" | "skipped"
```

## Mount just the webhook server

```ts
import { createWebhookServer, createGithubPayAgent } from "@jmgomezl/github-pay";

const agent = createGithubPayAgent({ accountId, privateKey, network: "testnet", geminiApiKey });
const app = createWebhookServer({ agent, webhookSecret: process.env.GITHUB_WEBHOOK_SECRET! });
app.listen(3000);
```

## GitHub webhook setup

Repository → Settings → Webhooks → Add webhook:
- **Payload URL:** `https://your-host/webhook`
- **Content type:** `application/json`
- **Secret:** your `GITHUB_WEBHOOK_SECRET`
- **Events:** Pull requests, Releases

A merged PR carrying a policy label pays the author automatically; a published
release seals provenance.
