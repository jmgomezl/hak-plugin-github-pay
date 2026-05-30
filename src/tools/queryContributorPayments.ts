import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { resolveGithubPayConfig } from "../config.js";
import { toCsv } from "../csv.js";
import { getTopicId } from "../hcs.js";
import { topicHashscanUrl } from "../networks.js";
import { getAllReceipts } from "../resolve.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  github_handle: z.string().optional().describe("Filter by GitHub handle"),
  hedera_account_id: z.string().optional().describe("Filter by Hedera account id"),
});

type Input = z.infer<typeof inputSchema>;

export class QueryContributorPaymentsTool extends GithubPayTool<Input> {
  method = "github_pay_query_contributor_payments";
  name = "GitHub Pay: Query Contributor Payments";
  description =
    "Read the RECEIPTS topic and return a contributor's full payment history as CSV (for finance/compliance), with Hashscan URLs. Filter by GitHub handle or Hedera account; omit both for the full ledger.";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, _client: Client) {
    const { network } = resolveGithubPayConfig(context);
    const receiptsTopicHashscanUrl = topicHashscanUrl(network, getTopicId("RECEIPTS"));

    const all = await getAllReceipts(network);
    const handle = params.github_handle?.replace(/^@/, "").toLowerCase();
    const filtered = all.filter((r) => {
      if (handle && r.githubHandle.toLowerCase() !== handle) return false;
      if (params.hedera_account_id && r.hederaAccountId !== params.hedera_account_id) return false;
      return true;
    });

    const csv = toCsv(
      [
        "timestamp",
        "repo",
        "pr_number",
        "github_handle",
        "hedera_account",
        "amount_hbar",
        "label",
        "transaction_id",
        "receipts_topic_hashscan",
      ],
      filtered.map((r) => [
        r.timestamp,
        r.repo,
        r.prNumber,
        r.githubHandle,
        r.hederaAccountId,
        r.amountHbar,
        r.label,
        r.transactionId,
        receiptsTopicHashscanUrl,
      ]),
    );

    return {
      count: filtered.length,
      totalHbar: filtered.reduce((s, r) => s + r.amountHbar, 0),
      receiptsTopicHashscanUrl,
      csv,
    };
  }
}

export const queryContributorPaymentsTool = new QueryContributorPaymentsTool();
