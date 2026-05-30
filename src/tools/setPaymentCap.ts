import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { resolveGithubPayConfig } from "../config.js";
import { recordOperation, submitMessage } from "../hcs.js";
import type { PaymentCap } from "../types.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  repo: z.string().describe("Repository in owner/name form"),
  monthly_cap_hbar: z
    .number()
    .positive()
    .describe("Maximum total HBAR the repo may pay out per calendar month"),
  per_contributor_cap_hbar: z
    .number()
    .positive()
    .describe("Maximum HBAR a single contributor may receive per calendar month"),
});

type Input = z.infer<typeof inputSchema>;

export class SetPaymentCapTool extends GithubPayTool<Input> {
  method = "github_pay_set_payment_cap";
  name = "GitHub Pay: Set Payment Cap";
  description =
    "Write a monthly + per-contributor HBAR spending ceiling for a repo to the POLICIES topic. Enforced by pay_on_merge before every transfer. Required enterprise financial control.";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, client: Client) {
    const { network } = resolveGithubPayConfig(context);
    const cap: PaymentCap = {
      kind: "payment_cap",
      repo: params.repo,
      monthlyCapHbar: params.monthly_cap_hbar,
      perContributorCapHbar: params.per_contributor_cap_hbar,
      timestamp: new Date().toISOString(),
    };
    const seal = await submitMessage(client, network, "POLICIES", cap);
    recordOperation(
      this.method,
      `${params.repo} monthly=${params.monthly_cap_hbar} perContrib=${params.per_contributor_cap_hbar}`,
    );
    return { cap, ...seal };
  }
}

export const setPaymentCapTool = new SetPaymentCapTool();
