import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { requirePayerAccount, resolveGithubPayConfig } from "../config.js";
import { type PayOnMergeResult, notifySlack, payOnMerge } from "../pay.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  repo: z.string().describe("Repository in owner/name form"),
  pr_number: z.number().int().describe("Merged pull-request number (idempotency key)"),
  pr_url: z.string().describe("HTML URL of the pull request"),
  pr_author: z.string().describe("GitHub handle of the PR author"),
  label: z.string().describe("Payment-triggering label present on the PR, e.g. bounty-50"),
});

type Input = z.infer<typeof inputSchema>;

export class PayOnMergeTool extends GithubPayTool<Input> {
  method = "github_pay_pay_on_merge";
  name = "GitHub Pay: Pay On Merge";
  description =
    "Core tool. For a merged PR: read the policy, resolve the contributor's Hedera account, enforce idempotency (PR number on RECEIPTS) and spending caps, transfer HBAR, and seal the receipt. Returns 'already paid' if the PR was already settled.";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, client: Client): Promise<PayOnMergeResult> {
    const config = resolveGithubPayConfig(context);
    const payer = requirePayerAccount(config);
    const slackUrl = config.slackWebhookUrl;
    const notify = slackUrl
      ? (paid: Extract<PayOnMergeResult, { status: "paid" }>) => notifySlack(slackUrl, paid)
      : undefined;

    return payOnMerge(
      client,
      config.network,
      payer,
      {
        repo: params.repo,
        prNumber: params.pr_number,
        prUrl: params.pr_url,
        prAuthor: params.pr_author,
        label: params.label,
      },
      notify,
    );
  }
}

export const payOnMergeTool = new PayOnMergeTool();
