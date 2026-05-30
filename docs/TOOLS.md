# Tools

All tools extend `GithubPayTool` (a `BaseTool` subclass) and resolve their config
from the HAK `Context` via `resolveGithubPayConfig`. Method names are namespaced
`github_pay_*` so they never collide with other plugins loaded into the same agent.

| Method | Topic | Purpose |
|--------|-------|---------|
| `github_pay_register_contributor` | IDENTITIES | Map a GitHub handle to a Hedera account |
| `github_pay_set_payment_policy` | POLICIES | Set `label → HBAR` rule for a repo |
| `github_pay_set_payment_cap` | POLICIES | Set monthly + per-contributor ceilings |
| `github_pay_pay_on_merge` | RECEIPTS | Pay a merged PR (idempotent, cap-enforced) |
| `github_pay_query_contributor_payments` | RECEIPTS | Payment history as CSV |
| `github_pay_seal_release_provenance` | RELEASES | SHA-256 release assets + commit |
| `github_pay_query_team_summary` | RECEIPTS | Per-contributor aggregate CSV |

---

### `github_pay_register_contributor`
**Params:** `github_handle: string`, `hedera_account_id: string`
**Returns:** `{ registered, topicId, sequenceNumber, hashscanUrl, note }`
Writes a self-sovereign identity record to the public IDENTITIES topic.

### `github_pay_set_payment_policy`
**Params:** `repo: string`, `label: string`, `amount_hbar: number`
**Returns:** `{ policy, topicId, sequenceNumber, hashscanUrl }`
Appends an immutable rule. Last write wins for a given `(repo, label)`.

### `github_pay_set_payment_cap`
**Params:** `repo: string`, `monthly_cap_hbar: number`, `per_contributor_cap_hbar: number`
**Returns:** `{ cap, topicId, sequenceNumber, hashscanUrl }`
Enforced by `pay_on_merge` before every transfer.

### `github_pay_pay_on_merge`
**Params:** `repo: string`, `pr_number: number`, `pr_url: string`, `pr_author: string`, `label: string`
**Returns:** one of
- `{ status: "paid", receipt, sequenceNumber, transactionHashscanUrl, receiptTopicHashscanUrl }`
- `{ status: "already_paid", receipt }`
- `{ status: "skipped", reason }`
Reads policy + identity + caps, enforces idempotency on the PR number, transfers HBAR, seals the receipt.

### `github_pay_query_contributor_payments`
**Params:** `github_handle?: string`, `hedera_account_id?: string`
**Returns:** `{ count, totalHbar, receiptsTopicHashscanUrl, csv }`
Omit both filters for the full ledger.

### `github_pay_seal_release_provenance`
**Params:** `repo: string`, `tag: string`, `commit_sha: string`, `asset_urls: string[]`
**Returns:** `{ provenance, sequenceNumber, hashscanUrl }`
Fetches and SHA-256-hashes each asset; seals `{repo, tag, commit_sha, asset_hashes, payer_account}`.

### `github_pay_query_team_summary`
**Params:** `repo?: string`, `since?: string` (ISO), `until?: string` (ISO)
**Returns:** `{ contributors, grandTotalHbar, window, csv }`
Aggregates receipts by contributor over an optional time window.
