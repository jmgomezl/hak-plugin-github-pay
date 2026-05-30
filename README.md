# @jmgomezl/github-pay

> When a GitHub PR is merged, an AI agent automatically pays the contributor in HBAR — and the policy, identity, receipt, and release provenance all live immutably on the Hedera Consensus Service.

A [HAK v4](https://github.com/hashgraph/hedera-agent-kit) (hedera-agent-kit) plugin built for **Hedera AI Agent Bounty — Week 2 (Enterprise Agent + Plugin)**. It turns the GitHub merge button into a payment rail: a contributor registers their Hedera account once, a repo admin sets a label→HBAR policy with a spending cap, and from then on every merged PR carrying that label pays out automatically, idempotently, and with a tamper-evident receipt on-chain. No database — the HCS topics *are* the source of truth.

---

## The IDENTITIES topic is a shared public good

The hardest part of paying open-source contributors on-chain is the identity problem: *which Hedera account belongs to this GitHub handle?* This plugin solves it once, in the open. Every `register_contributor` call writes a self-sovereign `{ githubHandle, hederaAccountId }` record to a public HCS **IDENTITIES** topic that anyone can read from the mirror node.

**No future HAK plugin needs to solve GitHub-to-Hedera identity again.** Point your plugin at the same IDENTITIES topic and resolve handles for free.

---

## What's inside — 7 tools

All are HAK v4 `BaseTool` subclasses, exposed through the plain-object plugin pattern (`githubPayPlugin`).

| Tool | HCS topic | What it does |
|------|-----------|--------------|
| `register_contributor` | IDENTITIES | Writes a self-sovereign `githubHandle → hederaAccountId` mapping. Public, reusable, no DB. |
| `set_payment_policy` | POLICIES | Repo admin writes an immutable rule: `label:bounty-50 → 50 HBAR to PR author`. |
| `set_payment_cap` | POLICIES | Writes a monthly + per-contributor HBAR ceiling. Enterprise financial control. |
| `pay_on_merge` | RECEIPTS | **Core.** Reads policy, resolves the contributor, enforces idempotency (PR number) and caps, executes a `TransferTransaction`, seals the receipt. |
| `query_contributor_payments` | RECEIPTS | Full payment history as **CSV** with Hashscan URLs, for finance/compliance. |
| `seal_release_provenance` | RELEASES | On a GitHub Release: SHA-256 every asset, seal `{repo, tag, commit_sha, asset_hashes, payer_account}`. |
| `query_team_summary` | RECEIPTS | Aggregates receipts by contributor over a time window → CSV. |

---

## Enterprise controls

- **HMAC webhook validation** — every incoming GitHub payload is verified against `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, constant-time compare) using `GITHUB_WEBHOOK_SECRET` *before* any processing.
- **Idempotency** — `pay_on_merge` checks the RECEIPTS topic for an existing receipt keyed on the PR number. If found, it returns `already_paid` and performs no transfer. Webhook retries and duplicate merge events are safe.
- **Spending caps** — `pay_on_merge` reads the active POLICIES cap and blocks any payment that would push the repo's monthly total, or a single contributor's monthly total, over the ceiling.
- **`GET /health`** — reports per-topic mirror-node connectivity, message counts, the payer account, and the last successful operation.
- **`createWebhookServer()`** — a ~120-line Express app you can mount anywhere, exporting `/webhook` and `/health`.
- **Topic auto-provisioning** — all four topics (IDENTITIES, POLICIES, RECEIPTS, RELEASES) are created on first run if missing; their IDs are persisted to `store.json` (same pattern as AI Court's `cases.json`).

### Human-in-the-loop

**The PR merge IS the approval. The POLICIES cap IS the financial control. GitHub's review workflow satisfies the 4-eyes principle.** A payment cannot happen without a human merging a reviewed pull request, and it cannot exceed a ceiling a human committed to the immutable POLICIES topic. The agent automates execution, not authorization.

---

## Quickstart

```bash
# 1. Install
npm install              # in this repo, or: npm install @jmgomezl/github-pay

# 2. Configure
cp .env.example .env     # then fill in HEDERA_*, GEMINI_API_KEY, GITHUB_WEBHOOK_SECRET

# 3. Build & run (provisions the 4 HCS topics, starts the webhook server + agent REPL)
npm run build
npm start
```

On first run you'll see the four topic IDs and their Hashscan links printed, and `store.json` written.

### Drive the agent in natural language (REPL)

```
github-pay > register @octocat as 0.0.654321
github-pay > set a policy: label bounty-50 pays 50 HBAR on jmgomezl/demo-repo
github-pay > set a cap of 500 HBAR/month and 200 per contributor on jmgomezl/demo-repo
github-pay > show me octocat's payment history
```

The agent (Gemini 2.5 Flash, function-calling) maps each request to the right tool.

### Or use the plugin directly in your own HAK agent

```ts
import { githubPayPlugin } from "@jmgomezl/github-pay/plugin";

const plugin = githubPayPlugin({
  network: "testnet",
  payerAccountId: "0.0.1234",
  geminiApiKey: process.env.GEMINI_API_KEY!,
});
// plugin.tools(context) → 7 BaseTool instances, ready for HederaAgentAPI
```

### Wire up the GitHub webhook

Point a repository webhook at `https://your-host/webhook`, content type `application/json`, secret = your `GITHUB_WEBHOOK_SECRET`, and subscribe to **Pull requests** and **Releases**. When a labeled PR is merged, the contributor is paid automatically.

---

## Live testnet topics

These four topics are live on Hedera **testnet** and carry real messages from the end-to-end run below — verify on Hashscan:

| Topic | ID | Hashscan |
|-------|----|----------|
| IDENTITIES | `0.0.9095825` | https://hashscan.io/testnet/topic/0.0.9095825 |
| POLICIES   | `0.0.9095826` | https://hashscan.io/testnet/topic/0.0.9095826 |
| RECEIPTS   | `0.0.9095828` | https://hashscan.io/testnet/topic/0.0.9095828 |
| RELEASES   | `0.0.9095829` | https://hashscan.io/testnet/topic/0.0.9095829 |

### Verified end-to-end run (testnet)

A full flow executed on-chain against these topics:

- **register_contributor** → `octo-demo` → `0.0.9095861` sealed on IDENTITIES (seq 2)
- **set_payment_policy** `bounty-50 → 50 HBAR` + **set_payment_cap** `500/mo, 200/contributor` on POLICIES
- **pay_on_merge** PR #42 → **50 HBAR transferred** · [transaction](https://hashscan.io/testnet/transaction/0.0.7231440%401780110787.382134615) · receipt sealed on RECEIPTS (seq 3)
- **idempotency** — replaying PR #42 returned `already_paid`, recipient balance stayed at exactly **50 ℏ** (no double payment)
- **seal_release_provenance** `v1.0.0` → SHA-256 of `package.json` sealed on RELEASES (seq 1)

The payer account for the run is `0.0.7231440`.

---

## Demo flow — the 100-second story

1. **Issue** — a maintainer opens a bounty issue and tags the eventual PR `bounty-50`.
2. **Policy** — `set_payment_policy` seals `bounty-50 → 50 HBAR` and `set_payment_cap` seals a 500 HBAR/month ceiling on the POLICIES topic.
3. **Register** — the contributor runs `register_contributor` once; their handle→account mapping lands on the public IDENTITIES topic.
4. **Merge** — the maintainer reviews and merges the PR. GitHub fires a `pull_request.closed` webhook (`merged: true`).
5. **Pay** — the server validates the HMAC, checks RECEIPTS for idempotency, confirms the cap, executes a `TransferTransaction`, and **50 HBAR lands in the contributor's wallet**.
6. **Receipt** — a signed receipt is sealed on the RECEIPTS topic; the Hashscan link to the transfer and the receipt is returned (and optionally posted to Slack/Teams).

Everything after step 4 is automatic and takes seconds.

---

## Release provenance & NIST SSDF

`seal_release_provenance` fetches every asset attached to a published GitHub Release, computes its SHA-256, and seals `{repo, tag, commit_sha, asset_hashes, payer_account}` on the RELEASES topic. This produces a tamper-evident, independently-verifiable record binding released binaries to a commit — directly supporting **NIST Secure Software Development Framework (SSDF)** practices for software supply-chain integrity (notably *PS.3 — archive and protect each software release* and *PS.2 — provide a mechanism for verifying software release integrity*). Anyone can re-download an asset, hash it, and compare against the on-chain digest.

---

## Architecture

```
GitHub PR merged ──HMAC──> /webhook (Express)
                              │
                              ▼
                        pay_on_merge
                   ┌──────────┼───────────┐
              read POLICIES  read         check RECEIPTS
              (rule + cap)   IDENTITIES   (idempotency)
                   └──────────┼───────────┘
                              ▼
                    TransferTransaction (HBAR)
                              ▼
                    seal Receipt → RECEIPTS topic
                              ▼
                 Hashscan URL  (+ optional Slack)
```

```
src/
├── index.ts                    main entry — provisions topics, starts agent + server
├── server.ts                   Express webhook, HMAC validation, /health, createWebhookServer()
├── agent.ts                    Gemini 2.5 Flash function-calling loop, zod→Gemini schema bridge
├── hcs.ts                      topic provisioning, loadStore/saveStore, mirror reads (chunk reassembly)
├── resolve.ts                  fold HCS topics into the current view (identity, policy, caps, receipts)
├── pay.ts                      payOnMerge + sealReleaseProvenance + Slack notify (shared by tool & webhook)
├── csv.ts                      RFC-4180 CSV serializer
├── types.ts                    topic names, payload shapes, store shape
└── plugin/
    └── githubPayPlugin.ts      HAK v4 plain-object plugin — all 7 BaseTool subclasses
```

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `HEDERA_ACCOUNT_ID` | ✅ | Payer account that funds bounties |
| `HEDERA_PRIVATE_KEY` | ✅ | Payer key (DER or ECDSA hex) |
| `HEDERA_NETWORK` | | `testnet` (default) or `mainnet` |
| `GEMINI_API_KEY` | ✅ | Gemini 2.5 Flash for the agent loop |
| `GITHUB_WEBHOOK_SECRET` | ✅ | HMAC secret for `X-Hub-Signature-256` |
| `GITHUB_TOKEN` | | Fetch private release assets for provenance |
| `SLACK_WEBHOOK_URL` | | Post a notification on each successful payment |
| `PORT` | | Webhook server port (default 3000) |

## License

MIT © jmgomezl
