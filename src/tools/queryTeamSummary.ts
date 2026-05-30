import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { resolveGithubPayConfig } from "../config.js";
import { toCsv } from "../csv.js";
import { getAllReceipts } from "../resolve.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  repo: z.string().optional().describe("Restrict to a single repo (owner/name)"),
  since: z.string().optional().describe("ISO date — only count receipts at/after this instant"),
  until: z.string().optional().describe("ISO date — only count receipts before this instant"),
});

type Input = z.infer<typeof inputSchema>;

export class QueryTeamSummaryTool extends GithubPayTool<Input> {
  method = "github_pay_query_team_summary";
  name = "GitHub Pay: Query Team Summary";
  description =
    "Aggregate RECEIPTS by contributor over an optional time window and return CSV (payments + total HBAR per contributor). For team finance reporting.";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, _client: Client) {
    const { network } = resolveGithubPayConfig(context);
    const since = params.since ? new Date(params.since).getTime() : Number.NEGATIVE_INFINITY;
    const until = params.until ? new Date(params.until).getTime() : Number.POSITIVE_INFINITY;

    const receipts = (await getAllReceipts(network)).filter((r) => {
      if (params.repo && r.repo !== params.repo) return false;
      const t = new Date(r.timestamp).getTime();
      return t >= since && t < until;
    });

    const byContributor = new Map<
      string,
      { handle: string; account: string; count: number; total: number }
    >();
    for (const r of receipts) {
      const cur = byContributor.get(r.hederaAccountId) ?? {
        handle: r.githubHandle,
        account: r.hederaAccountId,
        count: 0,
        total: 0,
      };
      cur.count += 1;
      cur.total += r.amountHbar;
      byContributor.set(r.hederaAccountId, cur);
    }

    const rows = [...byContributor.values()].sort((a, b) => b.total - a.total);
    const csv = toCsv(
      ["github_handle", "hedera_account", "payments", "total_hbar"],
      rows.map((r) => [r.handle, r.account, r.count, r.total]),
    );

    return {
      contributors: rows.length,
      grandTotalHbar: rows.reduce((s, r) => s + r.total, 0),
      window: { since: params.since ?? null, until: params.until ?? null },
      csv,
    };
  }
}

export const queryTeamSummaryTool = new QueryTeamSummaryTool();
