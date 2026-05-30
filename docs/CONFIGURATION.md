# Configuration

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `HEDERA_ACCOUNT_ID` | ✅ (app) | Payer account that funds bounties; also the HAK operator |
| `HEDERA_PRIVATE_KEY` | ✅ (app) | Payer key (DER `302…` or ECDSA hex, with or without `0x`) |
| `HEDERA_NETWORK` | | `testnet` (default) or `mainnet` |
| `GEMINI_API_KEY` | ✅ (app) | Gemini 2.5 Flash for the agent loop |
| `GITHUB_WEBHOOK_SECRET` | ✅ (app) | HMAC secret for `X-Hub-Signature-256` |
| `GITHUB_TOKEN` | | Fetch private release assets in `seal_release_provenance` |
| `SLACK_WEBHOOK_URL` | | Post a notification on each successful payment |
| `PORT` | | Webhook server port (default 3000) |
| `NO_REPL` | | Set to `1` to run headless (e.g. under PM2) |

The variables marked "(app)" are needed only by the runnable app (`npm start`).
When the plugin is embedded in another HAK host, it reads config from the
execution `Context` instead — see below.

## Plugin config resolution

Tools call `resolveGithubPayConfig(context)`. Precedence:

```
context.config.githubPay  >  context.pluginConfig.githubPay  >  process.env  >  defaults
```

`payerAccountId` additionally falls back to the HAK operator (`context.accountId`).

```ts
import { githubPayPlugin } from "@jmgomezl/github-pay";

const context = {
  accountId: "0.0.1234",            // operator = default payer
  config: {
    githubPay: {
      network: "mainnet",
      githubToken: process.env.GITHUB_TOKEN,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    },
  },
};

const tools = githubPayPlugin.tools(context);
```

`GithubPayConfig`:

```ts
type GithubPayConfig = {
  network: string;            // "testnet" | "mainnet"
  payerAccountId?: string;    // defaults to context.accountId
  githubToken?: string;
  slackWebhookUrl?: string;
};
```

## Topics & store.json

The four HCS topics are provisioned on first run and their IDs cached in
`store.json` (gitignored). `store.json` also keeps a fast-path idempotency guard
(`paidPrs`) and the last successful operation. Commit `store.template.json`, not
`store.json`.
