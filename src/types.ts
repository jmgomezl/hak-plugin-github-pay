// ─── Topic names ──────────────────────────────────────────────────────────────
// The four HCS topics this plugin provisions and reads. IDENTITIES is a public
// good: any future HAK plugin can resolve a GitHub handle to a Hedera account by
// reading the same topic.
export type TopicName = "IDENTITIES" | "POLICIES" | "RECEIPTS" | "RELEASES";

// ─── Local store (store.json) ─────────────────────────────────────────────────
export type Store = {
  topics: Record<TopicName, string | null>;
  // Fast-path idempotency guard. The RECEIPTS topic is the durable source of
  // truth, but the mirror node lags consensus by a few seconds; this local set
  // of "repo#prNumber" keys closes the race for rapid webhook retries and
  // survives restarts. Written synchronously the instant a payment settles.
  paidPrs?: string[];
  lastOperation: {
    tool: string;
    timestamp: string;
    detail: string;
  } | null;
};

// ─── HCS message payloads ─────────────────────────────────────────────────────

export type IdentityRecord = {
  kind: "identity";
  githubHandle: string;
  hederaAccountId: string;
  timestamp: string;
};

export type PolicyRule = {
  kind: "policy_rule";
  repo: string;
  label: string;
  amountHbar: number;
  recipient: "pr_author";
  timestamp: string;
};

export type PaymentCap = {
  kind: "payment_cap";
  repo: string;
  monthlyCapHbar: number;
  perContributorCapHbar: number;
  timestamp: string;
};

export type Receipt = {
  kind: "receipt";
  repo: string;
  prNumber: number;
  prUrl: string;
  githubHandle: string;
  hederaAccountId: string;
  amountHbar: number;
  label: string;
  transactionId: string;
  timestamp: string;
};

export type ReleaseProvenance = {
  kind: "release_provenance";
  repo: string;
  tag: string;
  commitSha: string;
  assetHashes: Array<{ name: string; sha256: string; sizeBytes: number }>;
  payerAccount: string;
  timestamp: string;
};

// ─── Tool result helpers ──────────────────────────────────────────────────────
export type SealResult = {
  topicId: string;
  sequenceNumber: string;
  hashscanUrl: string;
};
