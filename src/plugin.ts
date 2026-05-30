import type { Plugin } from "@hashgraph/hedera-agent-kit";
import { payOnMergeTool } from "./tools/payOnMerge.js";
import { queryContributorPaymentsTool } from "./tools/queryContributorPayments.js";
import { queryTeamSummaryTool } from "./tools/queryTeamSummary.js";
import { registerContributorTool } from "./tools/registerContributor.js";
import { sealReleaseProvenanceTool } from "./tools/sealReleaseProvenance.js";
import { setPaymentCapTool } from "./tools/setPaymentCap.js";
import { setPaymentPolicyTool } from "./tools/setPaymentPolicy.js";

// Stable tool method identifiers, exposed so hosts can allowlist/reference them.
export const githubPayPluginToolNames = {
  GITHUB_PAY_REGISTER_CONTRIBUTOR_TOOL: "github_pay_register_contributor",
  GITHUB_PAY_SET_PAYMENT_POLICY_TOOL: "github_pay_set_payment_policy",
  GITHUB_PAY_SET_PAYMENT_CAP_TOOL: "github_pay_set_payment_cap",
  GITHUB_PAY_PAY_ON_MERGE_TOOL: "github_pay_pay_on_merge",
  GITHUB_PAY_QUERY_CONTRIBUTOR_PAYMENTS_TOOL: "github_pay_query_contributor_payments",
  GITHUB_PAY_SEAL_RELEASE_PROVENANCE_TOOL: "github_pay_seal_release_provenance",
  GITHUB_PAY_QUERY_TEAM_SUMMARY_TOOL: "github_pay_query_team_summary",
} as const;

/**
 * github-pay — HAK v4 plugin. Configuration is read from the HAK Context via
 * `resolveGithubPayConfig`, so the same plugin instance works in any agent host.
 */
export const githubPayPlugin: Plugin = {
  name: "github-pay",
  version: "1.0.0",
  description:
    "When a GitHub PR is merged, an AI agent pays the contributor in HBAR. Policy, identity, receipts, and release provenance live immutably on Hedera Consensus Service.",
  tools: () => [
    registerContributorTool,
    setPaymentPolicyTool,
    setPaymentCapTool,
    payOnMergeTool,
    queryContributorPaymentsTool,
    sealReleaseProvenanceTool,
    queryTeamSummaryTool,
  ],
};

export { githubPayPlugin as default };
