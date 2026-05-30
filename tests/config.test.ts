import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requirePayerAccount, resolveGithubPayConfig } from "../src/config";

const ENV_KEYS = ["HEDERA_NETWORK", "HEDERA_ACCOUNT_ID", "GITHUB_TOKEN", "SLACK_WEBHOOK_URL"];

describe("resolveGithubPayConfig", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to testnet with no config", () => {
    expect(resolveGithubPayConfig().network).toBe("testnet");
  });

  it("falls back to the HAK operator account for the payer", () => {
    const cfg = resolveGithubPayConfig({ accountId: "0.0.42" } as never);
    expect(cfg.payerAccountId).toBe("0.0.42");
  });

  it("context.config.githubPay overrides env", () => {
    process.env.HEDERA_NETWORK = "testnet";
    const cfg = resolveGithubPayConfig({
      accountId: "0.0.1",
      config: { githubPay: { network: "mainnet", payerAccountId: "0.0.999" } },
    } as never);
    expect(cfg.network).toBe("mainnet");
    expect(cfg.payerAccountId).toBe("0.0.999");
  });

  it("reads env when context is absent", () => {
    process.env.HEDERA_NETWORK = "mainnet";
    process.env.HEDERA_ACCOUNT_ID = "0.0.7";
    process.env.GITHUB_TOKEN = "ghtok";
    const cfg = resolveGithubPayConfig();
    expect(cfg).toMatchObject({
      network: "mainnet",
      payerAccountId: "0.0.7",
      githubToken: "ghtok",
    });
  });

  it("requirePayerAccount throws when no payer is configured", () => {
    expect(() => requirePayerAccount(resolveGithubPayConfig())).toThrow(/payer account/i);
  });
});
