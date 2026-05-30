import type { TopicName } from "./types.js";

// ─── Network endpoints ────────────────────────────────────────────────────────

export type HederaNetwork = "mainnet" | "testnet";

export type GithubPayNetworkDefaults = {
  hashscanBase: string;
  mirrorBase: string;
};

export const GITHUB_PAY_MAINNET: GithubPayNetworkDefaults = {
  hashscanBase: "https://hashscan.io/mainnet",
  mirrorBase: "https://mainnet.mirrornode.hedera.com",
};

export const GITHUB_PAY_TESTNET: GithubPayNetworkDefaults = {
  hashscanBase: "https://hashscan.io/testnet",
  mirrorBase: "https://testnet.mirrornode.hedera.com",
};

export const NETWORK_DEFAULTS: Record<string, GithubPayNetworkDefaults> = {
  mainnet: GITHUB_PAY_MAINNET,
  testnet: GITHUB_PAY_TESTNET,
};

function defaultsFor(network: string): GithubPayNetworkDefaults {
  return NETWORK_DEFAULTS[network] ?? GITHUB_PAY_TESTNET;
}

export function hashscanBase(network: string): string {
  return defaultsFor(network).hashscanBase;
}

export function mirrorBase(network: string): string {
  return defaultsFor(network).mirrorBase;
}

export function topicHashscanUrl(network: string, topicId: string): string {
  return `${hashscanBase(network)}/topic/${topicId}`;
}

export function transactionHashscanUrl(network: string, transactionId: string): string {
  return `${hashscanBase(network)}/transaction/${encodeURIComponent(transactionId)}`;
}

// ─── Topic metadata ───────────────────────────────────────────────────────────

export const TOPIC_NAMES: TopicName[] = ["IDENTITIES", "POLICIES", "RECEIPTS", "RELEASES"];

export const TOPIC_MEMOS: Record<TopicName, string> = {
  IDENTITIES: "github-pay :: IDENTITIES — public GitHub handle ↔ Hedera account registry",
  POLICIES: "github-pay :: POLICIES — immutable payment rules & spending caps",
  RECEIPTS: "github-pay :: RECEIPTS — sealed bounty payment receipts",
  RELEASES: "github-pay :: RELEASES — software release provenance (SHA-256 + commit)",
};
