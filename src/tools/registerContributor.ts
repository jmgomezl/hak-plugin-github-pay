import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { resolveGithubPayConfig } from "../config.js";
import { recordOperation, submitMessage } from "../hcs.js";
import type { IdentityRecord } from "../types.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  github_handle: z.string().describe("GitHub username, with or without a leading @"),
  hedera_account_id: z.string().describe("Hedera account id, e.g. 0.0.12345"),
});

type Input = z.infer<typeof inputSchema>;

export class RegisterContributorTool extends GithubPayTool<Input> {
  method = "github_pay_register_contributor";
  name = "GitHub Pay: Register Contributor";
  description =
    "Register a self-sovereign GitHub handle → Hedera account mapping on the public IDENTITIES HCS topic. No database. Any HAK plugin can reuse this registry.";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, client: Client) {
    const { network } = resolveGithubPayConfig(context);
    const record: IdentityRecord = {
      kind: "identity",
      githubHandle: params.github_handle.replace(/^@/, ""),
      hederaAccountId: params.hedera_account_id,
      timestamp: new Date().toISOString(),
    };
    const seal = await submitMessage(client, network, "IDENTITIES", record);
    recordOperation(this.method, `${record.githubHandle} → ${record.hederaAccountId}`);
    return {
      registered: record,
      topicId: seal.topicId,
      sequenceNumber: seal.sequenceNumber,
      hashscanUrl: seal.hashscanUrl,
      note: "This mapping is now a public good — any HAK plugin can resolve this handle.",
    };
  }
}

export const registerContributorTool = new RegisterContributorTool();
