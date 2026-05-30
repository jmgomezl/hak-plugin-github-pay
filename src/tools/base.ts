import { BaseTool } from "@hashgraph/hedera-agent-kit";
import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";

/**
 * Shared base for github-pay tools. These tools perform their work in
 * `coreAction` (read or submit a single HCS message / transfer) and have no
 * secondary phase, mirroring the read-only tool pattern in the sibling HAK
 * plugins (saucerswap, stader, …).
 */
export abstract class GithubPayTool<TParams> extends BaseTool<TParams, TParams> {
  async normalizeParams(params: TParams, _context: Context, _client: Client): Promise<TParams> {
    return this.parameters.parse(params) as TParams;
  }

  override async shouldSecondaryAction(_result: unknown, _context: Context): Promise<boolean> {
    return false;
  }

  async secondaryAction(result: unknown, _client: Client, _context: Context): Promise<unknown> {
    return result;
  }
}
