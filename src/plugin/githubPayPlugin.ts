import { BaseTool } from "@hashgraph/hedera-agent-kit";
import type { Context } from "@hashgraph/hedera-agent-kit";
import { Client } from "@hiero-ledger/sdk";
import { z } from "zod";

import { submitMessage, recordOperation, getTopicId, topicHashscanUrl } from "../hcs.js";
import { getAllReceipts } from "../resolve.js";
import {
  payOnMerge,
  sealReleaseProvenance,
  notifySlack,
  type PayOnMergeResult,
} from "../pay.js";
import { toCsv } from "../csv.js";
import type {
  IdentityRecord,
  PolicyRule,
  PaymentCap,
  Receipt,
} from "../types.js";

type PluginConfig = {
  network: string;
  payerAccountId: string;
  geminiApiKey: string;
  githubToken?: string;
  slackWebhookUrl?: string;
};

// Every tool extends HAK v4's BaseTool. We only need normalizeParams + coreAction;
// the secondary-action hooks are no-ops (same as AICourt's tools).
abstract class SimpleTool<TParams> extends BaseTool<TParams, TParams> {
  async normalizeParams(params: TParams, _ctx: Context, _client: Client): Promise<TParams> {
    return params;
  }
  async shouldSecondaryAction(_r: unknown, _ctx: Context): Promise<boolean> {
    return false;
  }
  async secondaryAction(result: unknown, _client: Client, _ctx: Context): Promise<unknown> {
    return result;
  }
}

// ─── 1. register_contributor ──────────────────────────────────────────────────

class RegisterContributorTool extends SimpleTool<{
  github_handle: string;
  hedera_account_id: string;
}> {
  method = "register_contributor";
  name = "register_contributor";
  description =
    "Register a self-sovereign GitHub handle → Hedera account mapping on the public IDENTITIES HCS topic. No database. Any HAK plugin can reuse this registry.";
  parameters = z.object({
    github_handle: z.string().describe("GitHub username, with or without a leading @"),
    hedera_account_id: z.string().describe("Hedera account id, e.g. 0.0.12345"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { github_handle: string; hedera_account_id: string },
    _ctx: Context,
    client: Client
  ) {
    const record: IdentityRecord = {
      kind: "identity",
      githubHandle: params.github_handle.replace(/^@/, ""),
      hederaAccountId: params.hedera_account_id,
      timestamp: new Date().toISOString(),
    };
    const seal = await submitMessage(client, this.cfg.network, "IDENTITIES", record);
    recordOperation("register_contributor", `${record.githubHandle} → ${record.hederaAccountId}`);
    return {
      registered: record,
      topicId: seal.topicId,
      sequenceNumber: seal.sequenceNumber,
      hashscanUrl: seal.hashscanUrl,
      note: "This mapping is now a public good — any HAK plugin can resolve this handle.",
    };
  }
}

// ─── 2. set_payment_policy ────────────────────────────────────────────────────

class SetPaymentPolicyTool extends SimpleTool<{
  repo: string;
  label: string;
  amount_hbar: number;
}> {
  method = "set_payment_policy";
  name = "set_payment_policy";
  description =
    "Repo admin writes an immutable payment rule to the POLICIES HCS topic, e.g. label 'bounty-50' pays 50 HBAR to the PR author. Appended as an audit trail; last write wins.";
  parameters = z.object({
    repo: z.string().describe("Repository in owner/name form, e.g. jmgomezl/hak-plugin-github-pay"),
    label: z.string().describe("GitHub label that triggers payment, e.g. bounty-50"),
    amount_hbar: z.number().positive().describe("HBAR paid to the PR author when this label is present on a merged PR"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { repo: string; label: string; amount_hbar: number },
    _ctx: Context,
    client: Client
  ) {
    const rule: PolicyRule = {
      kind: "policy_rule",
      repo: params.repo,
      label: params.label,
      amountHbar: params.amount_hbar,
      recipient: "pr_author",
      timestamp: new Date().toISOString(),
    };
    const seal = await submitMessage(client, this.cfg.network, "POLICIES", rule);
    recordOperation("set_payment_policy", `${params.repo} ${params.label} → ${params.amount_hbar} HBAR`);
    return { policy: rule, ...seal };
  }
}

// ─── 3. set_payment_cap ───────────────────────────────────────────────────────

class SetPaymentCapTool extends SimpleTool<{
  repo: string;
  monthly_cap_hbar: number;
  per_contributor_cap_hbar: number;
}> {
  method = "set_payment_cap";
  name = "set_payment_cap";
  description =
    "Write a monthly + per-contributor HBAR spending ceiling for a repo to the POLICIES topic. Enforced by pay_on_merge before every transfer. Required enterprise financial control.";
  parameters = z.object({
    repo: z.string().describe("Repository in owner/name form"),
    monthly_cap_hbar: z.number().positive().describe("Maximum total HBAR the repo may pay out per calendar month"),
    per_contributor_cap_hbar: z.number().positive().describe("Maximum HBAR a single contributor may receive per calendar month"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { repo: string; monthly_cap_hbar: number; per_contributor_cap_hbar: number },
    _ctx: Context,
    client: Client
  ) {
    const cap: PaymentCap = {
      kind: "payment_cap",
      repo: params.repo,
      monthlyCapHbar: params.monthly_cap_hbar,
      perContributorCapHbar: params.per_contributor_cap_hbar,
      timestamp: new Date().toISOString(),
    };
    const seal = await submitMessage(client, this.cfg.network, "POLICIES", cap);
    recordOperation(
      "set_payment_cap",
      `${params.repo} monthly=${params.monthly_cap_hbar} perContrib=${params.per_contributor_cap_hbar}`
    );
    return { cap, ...seal };
  }
}

// ─── 4. pay_on_merge ──────────────────────────────────────────────────────────

class PayOnMergeTool extends SimpleTool<{
  repo: string;
  pr_number: number;
  pr_url: string;
  pr_author: string;
  label: string;
}> {
  method = "pay_on_merge";
  name = "pay_on_merge";
  description =
    "Core tool. For a merged PR: read the policy, resolve the contributor's Hedera account, enforce idempotency (PR number on RECEIPTS) and spending caps, transfer HBAR, and seal the receipt. Returns 'already paid' if the PR was already settled.";
  parameters = z.object({
    repo: z.string().describe("Repository in owner/name form"),
    pr_number: z.number().int().describe("Merged pull-request number (idempotency key)"),
    pr_url: z.string().describe("HTML URL of the pull request"),
    pr_author: z.string().describe("GitHub handle of the PR author"),
    label: z.string().describe("Payment-triggering label present on the PR, e.g. bounty-50"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { repo: string; pr_number: number; pr_url: string; pr_author: string; label: string },
    _ctx: Context,
    client: Client
  ): Promise<PayOnMergeResult> {
    const notify = this.cfg.slackWebhookUrl
      ? (paid: Extract<PayOnMergeResult, { status: "paid" }>) =>
          notifySlack(this.cfg.slackWebhookUrl!, paid)
      : undefined;

    return payOnMerge(
      client,
      this.cfg.network,
      this.cfg.payerAccountId,
      {
        repo: params.repo,
        prNumber: params.pr_number,
        prUrl: params.pr_url,
        prAuthor: params.pr_author,
        label: params.label,
      },
      notify
    );
  }
}

// ─── 5. query_contributor_payments ────────────────────────────────────────────

class QueryContributorPaymentsTool extends SimpleTool<{
  github_handle?: string;
  hedera_account_id?: string;
}> {
  method = "query_contributor_payments";
  name = "query_contributor_payments";
  description =
    "Read the RECEIPTS topic and return a contributor's full payment history as CSV (for finance/compliance), with Hashscan URLs. Filter by GitHub handle or Hedera account; omit both for the full ledger.";
  parameters = z.object({
    github_handle: z.string().optional().describe("Filter by GitHub handle"),
    hedera_account_id: z.string().optional().describe("Filter by Hedera account id"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { github_handle?: string; hedera_account_id?: string },
    _ctx: Context,
    _client: Client
  ) {
    const all = await getAllReceipts(this.cfg.network);
    const handle = params.github_handle?.replace(/^@/, "").toLowerCase();
    const filtered = all.filter((r) => {
      if (handle && r.githubHandle.toLowerCase() !== handle) return false;
      if (params.hedera_account_id && r.hederaAccountId !== params.hedera_account_id) return false;
      return true;
    });

    const csv = toCsv(
      ["timestamp", "repo", "pr_number", "github_handle", "hedera_account", "amount_hbar", "label", "transaction_id", "transaction_hashscan"],
      filtered.map((r) => [
        r.timestamp,
        r.repo,
        r.prNumber,
        r.githubHandle,
        r.hederaAccountId,
        r.amountHbar,
        r.label,
        r.transactionId,
        `${topicHashscanUrl(this.cfg.network, getTopicId("RECEIPTS"))}`,
      ])
    );

    return {
      count: filtered.length,
      totalHbar: filtered.reduce((s, r) => s + r.amountHbar, 0),
      receiptsTopicHashscanUrl: topicHashscanUrl(this.cfg.network, getTopicId("RECEIPTS")),
      csv,
    };
  }
}

// ─── 6. seal_release_provenance ───────────────────────────────────────────────

class SealReleaseProvenanceTool extends SimpleTool<{
  repo: string;
  tag: string;
  commit_sha: string;
  asset_urls: string[];
}> {
  method = "seal_release_provenance";
  name = "seal_release_provenance";
  description =
    "On a GitHub Release: fetch each asset, compute its SHA-256, and seal {repo, tag, commit_sha, asset_hashes, payer_account} on the RELEASES topic. A tamper-evident software supply-chain audit trail (supports NIST SSDF).";
  parameters = z.object({
    repo: z.string().describe("Repository in owner/name form"),
    tag: z.string().describe("Release tag, e.g. v1.0.0"),
    commit_sha: z.string().describe("Commit SHA the release was built from"),
    asset_urls: z.array(z.string()).describe("Download URLs of the release assets to hash"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { repo: string; tag: string; commit_sha: string; asset_urls: string[] },
    _ctx: Context,
    client: Client
  ) {
    const result = await sealReleaseProvenance(
      client,
      this.cfg.network,
      this.cfg.payerAccountId,
      {
        repo: params.repo,
        tag: params.tag,
        commitSha: params.commit_sha,
        assetUrls: params.asset_urls,
      },
      this.cfg.githubToken
    );
    return result;
  }
}

// ─── 7. query_team_summary (nice-to-have) ─────────────────────────────────────

class QueryTeamSummaryTool extends SimpleTool<{
  repo?: string;
  since?: string;
  until?: string;
}> {
  method = "query_team_summary";
  name = "query_team_summary";
  description =
    "Aggregate RECEIPTS by contributor over an optional time window and return CSV (payments + total HBAR per contributor). For team finance reporting.";
  parameters = z.object({
    repo: z.string().optional().describe("Restrict to a single repo (owner/name)"),
    since: z.string().optional().describe("ISO date — only count receipts at/after this instant"),
    until: z.string().optional().describe("ISO date — only count receipts before this instant"),
  });

  constructor(private cfg: PluginConfig) {
    super();
  }

  async coreAction(
    params: { repo?: string; since?: string; until?: string },
    _ctx: Context,
    _client: Client
  ) {
    const since = params.since ? new Date(params.since).getTime() : -Infinity;
    const until = params.until ? new Date(params.until).getTime() : Infinity;

    const receipts = (await getAllReceipts(this.cfg.network)).filter((r) => {
      if (params.repo && r.repo !== params.repo) return false;
      const t = new Date(r.timestamp).getTime();
      return t >= since && t < until;
    });

    const byContributor = new Map<string, { handle: string; account: string; count: number; total: number }>();
    for (const r of receipts) {
      const key = r.hederaAccountId;
      const cur = byContributor.get(key) ?? { handle: r.githubHandle, account: r.hederaAccountId, count: 0, total: 0 };
      cur.count += 1;
      cur.total += r.amountHbar;
      byContributor.set(key, cur);
    }

    const rows = [...byContributor.values()].sort((a, b) => b.total - a.total);
    const csv = toCsv(
      ["github_handle", "hedera_account", "payments", "total_hbar"],
      rows.map((r) => [r.handle, r.account, r.count, r.total])
    );

    return {
      contributors: rows.length,
      grandTotalHbar: rows.reduce((s, r) => s + r.total, 0),
      window: { since: params.since ?? null, until: params.until ?? null },
      csv,
    };
  }
}

// ─── Plugin (plain object — HAK v4 pattern, same as AICourt's courtPlugin) ─────

export const githubPayPlugin = (cfg: PluginConfig) => ({
  name: "github-pay",
  version: "1.0.0",
  description:
    "When a GitHub PR is merged, an AI agent pays the contributor in HBAR. Policy, identity, receipts, and release provenance live immutably on Hedera Consensus Service.",
  tools: (_ctx: Context) => [
    new RegisterContributorTool(cfg),
    new SetPaymentPolicyTool(cfg),
    new SetPaymentCapTool(cfg),
    new PayOnMergeTool(cfg),
    new QueryContributorPaymentsTool(cfg),
    new SealReleaseProvenanceTool(cfg),
    new QueryTeamSummaryTool(cfg),
  ],
});

export type { PluginConfig };
