import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { resolveGithubPayConfig } from "../config.js";
import { recordOperation, submitMessage } from "../hcs.js";
import { parsePrivateKey } from "../keys.js";
import type { PolicyRule } from "../types.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  repo: z.string().describe("Repository in owner/name form, e.g. jmgomezl/hak-plugin-github-pay"),
  label: z.string().describe("GitHub label that triggers payment, e.g. bounty-50"),
  amount_hbar: z
    .number()
    .positive()
    .describe("HBAR paid to the PR author when this label is present on a merged PR"),
});

type Input = z.infer<typeof inputSchema>;

export class SetPaymentPolicyTool extends GithubPayTool<Input> {
  method = "github_pay_set_payment_policy";
  name = "GitHub Pay: Set Payment Policy";
  description =
    "Repo admin writes an immutable payment rule to the POLICIES HCS topic, e.g. label 'bounty-50' pays 50 HBAR to the PR author. Appended as an audit trail; last write wins.";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, client: Client) {
    const { network, policyAdminKey } = resolveGithubPayConfig(context);
    const rule: PolicyRule = {
      kind: "policy_rule",
      repo: params.repo,
      label: params.label,
      amountHbar: params.amount_hbar,
      recipient: "pr_author",
      timestamp: new Date().toISOString(),
    };
    const submitKey = policyAdminKey ? parsePrivateKey(policyAdminKey) : undefined;
    const seal = await submitMessage(client, network, "POLICIES", rule, submitKey);
    recordOperation(this.method, `${params.repo} ${params.label} → ${params.amount_hbar} HBAR`);
    return { policy: rule, ...seal };
  }
}

export const setPaymentPolicyTool = new SetPaymentPolicyTool();
