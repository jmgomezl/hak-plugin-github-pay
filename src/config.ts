import type { Context } from "@hashgraph/hedera-agent-kit";

// Resolved configuration for the github-pay tools. The tools read this from the
// HAK execution Context so the same plugin works in any agent host without
// re-wiring — matching the house convention (resolve{Protocol}Config(context)).
export type GithubPayConfig = {
  network: string;
  /** Account that funds bounty transfers — defaults to the HAK operator. */
  payerAccountId?: string;
  /** Optional token for fetching private release assets in seal_release_provenance. */
  githubToken?: string;
  /** Optional Slack/Teams incoming-webhook URL for payment notifications. */
  slackWebhookUrl?: string;
};

type ContextWithConfig = {
  accountId?: string;
  config?: { githubPay?: Partial<GithubPayConfig> };
  pluginConfig?: { githubPay?: Partial<GithubPayConfig> };
};

/**
 * Resolve github-pay configuration with precedence:
 *   context.config.githubPay  >  context.pluginConfig.githubPay  >  env  >  defaults
 *
 * `payerAccountId` additionally falls back to the HAK operator (`context.accountId`).
 */
export function resolveGithubPayConfig(context?: Context): GithubPayConfig {
  const ctx = (context ?? {}) as ContextWithConfig;
  const fromCtx: Partial<GithubPayConfig> = {
    ...(ctx.pluginConfig?.githubPay ?? {}),
    ...(ctx.config?.githubPay ?? {}),
  };

  const network = fromCtx.network ?? process.env.HEDERA_NETWORK ?? "testnet";

  return {
    network,
    payerAccountId: fromCtx.payerAccountId ?? ctx.accountId ?? process.env.HEDERA_ACCOUNT_ID,
    githubToken: fromCtx.githubToken ?? process.env.GITHUB_TOKEN ?? undefined,
    slackWebhookUrl: fromCtx.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL ?? undefined,
  };
}

/** Resolve the payer account or throw a clear error if none is configured. */
export function requirePayerAccount(config: GithubPayConfig): string {
  if (!config.payerAccountId) {
    throw new Error(
      "No payer account configured. Set context.accountId, context.config.githubPay.payerAccountId, or HEDERA_ACCOUNT_ID.",
    );
  }
  return config.payerAccountId;
}
