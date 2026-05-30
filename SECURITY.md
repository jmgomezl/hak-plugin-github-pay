# Security & Threat Model

`hak-github-pay-plugin` moves real value (HBAR) automatically in response to
GitHub events. This document states the trust model, the controls that protect
each step, and the known limitations — explicitly, so operators can make an
informed deployment decision.

## Trust boundaries

```
 GitHub  ──(1) HMAC──▶  Webhook server  ──(2) policy/identity/caps──▶  HCS topics
                              │
                              ▼
                     (3) HBAR TransferTransaction  ──(4) receipt──▶  RECEIPTS topic
```

| # | Boundary | Control |
|---|----------|---------|
| 1 | GitHub → server | **HMAC-SHA256** over the raw body (`X-Hub-Signature-256`), constant-time compared, validated **before any parsing or processing**. An unsigned or tampered payload is rejected with `401`. |
| 2 | Authorization to pay | **The PR merge is the authorization.** A payment only fires on `pull_request.closed` with `merged: true`. GitHub's review + merge workflow is the human approval gate (4-eyes). |
| 3 | Amount & frequency | **Spending caps** (monthly + per-contributor) read from the POLICIES topic block any transfer that would breach a ceiling. **Idempotency** prevents paying the same PR twice. |
| 4 | Auditability | Every payment seals an immutable **receipt** on HCS, independently verifiable on Hashscan. Releases seal **SHA-256 provenance** (NIST SSDF). |

## Financial controls (defense in depth)

1. **Human approval** — no merge, no pay. Enforced by checking `merged: true`.
2. **Policy allowlist** — a label only pays if a `set_payment_policy` rule exists for `(repo, label)`. Unknown labels return `skipped`, never a default payout.
3. **Spending caps** — `set_payment_cap` writes monthly + per-contributor ceilings; `pay_on_merge` refuses any transfer that would exceed them.
4. **Admin/payer key separation (enforced on-chain)** — when `POLICY_ADMIN_KEY` is configured, the POLICIES topic is created with that key as its HCS **submitKey**. Payment rules and caps can then *only* be written by the admin key; the payer key that sends HBAR **cannot raise its own cap**. A compromised payer key can spend up to the existing cap but cannot lift it. Proven on testnet (`scripts/prove-admin-key.mjs`): a payer-key-only write to POLICIES is rejected with `INVALID_SIGNATURE`.
5. **Idempotency** — see below; a PR is paid at most once.
6. **Immutable audit trail** — policy, identity, receipts, and provenance are append-only on HCS and cannot be rewritten.

## Idempotency guarantee

`pay_on_merge` is idempotent on `(repo, prNumber)` via **two layers**:

- **Durable** — the RECEIPTS topic is the cross-host source of truth. Before paying, the topic is checked for an existing receipt.
- **Fast-path** — because the mirror node lags consensus by a few seconds, a synchronous local guard in `store.json` (plus an in-process in-flight lock) closes that window for rapid webhook retries on a single instance.

This was validated on testnet: a duplicate PR event returns `already_paid` and the recipient balance is unchanged. *(Test: `tests/server.test.ts`, cap math in `tests/resolve.test.ts`; live run documented in the README.)*

## Secrets

- `HEDERA_PRIVATE_KEY`, `GEMINI_API_KEY`, and `GITHUB_WEBHOOK_SECRET` are read from the environment only. Nothing secret is committed: `.env`, `.npmrc`, and `store.json` are gitignored.
- `store.json` (topic IDs + idempotency cache) is local state, not a secret, but is gitignored to keep deployments self-describing — commit `store.template.json` instead.

## Known limitations (deploy accordingly)

We document these rather than hide them:

1. **Single-instance idempotency.** The fast-path guard and in-flight lock are per-process. Running multiple webhook replicas behind a load balancer reopens the mirror-lag window — for multi-instance, back the guard with a shared store (Redis/DB) or on-chain dedup. The durable RECEIPTS check still applies once the mirror indexes.
2. **Key custody.** Keys live in the environment, not a KMS/HSM. The admin/payer key separation above limits blast radius, but for production hold both keys in your platform's secret manager (or an HSM) and rotate regularly.
3. **Crash window.** The transfer and the receipt seal are sequential; a crash between them leaves a payment whose receipt is pending. The local guard prevents a re-pay on retry; a durable queue would close this fully.

## Reporting a vulnerability

Open a private security advisory on the repository, or email the maintainer.
Please do not file public issues for exploitable findings.
