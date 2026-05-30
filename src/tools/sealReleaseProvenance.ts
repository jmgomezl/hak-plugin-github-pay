import type { Context } from "@hashgraph/hedera-agent-kit";
import type { Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import { requirePayerAccount, resolveGithubPayConfig } from "../config.js";
import { sealReleaseProvenance } from "../pay.js";
import { GithubPayTool } from "./base.js";

const inputSchema = z.object({
  repo: z.string().describe("Repository in owner/name form"),
  tag: z.string().describe("Release tag, e.g. v1.0.0"),
  commit_sha: z.string().describe("Commit SHA the release was built from"),
  asset_urls: z.array(z.string()).describe("Download URLs of the release assets to hash"),
});

type Input = z.infer<typeof inputSchema>;

export class SealReleaseProvenanceTool extends GithubPayTool<Input> {
  method = "github_pay_seal_release_provenance";
  name = "GitHub Pay: Seal Release Provenance";
  description =
    "On a GitHub Release: fetch each asset, compute its SHA-256, and seal {repo, tag, commit_sha, asset_hashes, payer_account} on the RELEASES topic. A tamper-evident software supply-chain audit trail (supports NIST SSDF).";
  parameters = inputSchema;

  async coreAction(params: Input, context: Context, client: Client) {
    const config = resolveGithubPayConfig(context);
    const payer = requirePayerAccount(config);
    return sealReleaseProvenance(
      client,
      config.network,
      payer,
      {
        repo: params.repo,
        tag: params.tag,
        commitSha: params.commit_sha,
        assetUrls: params.asset_urls,
      },
      config.githubToken,
    );
  }
}

export const sealReleaseProvenanceTool = new SealReleaseProvenanceTool();
