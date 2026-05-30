// @jmgomezl/github-pay — public library surface.
//
// The default export is the HAK v4 plugin; everything a host needs to embed,
// configure, or drive the plugin is re-exported here.

export { githubPayPlugin, githubPayPluginToolNames, default } from "./plugin.js";

// Configuration
export { resolveGithubPayConfig, requirePayerAccount } from "./config.js";
export type { GithubPayConfig } from "./config.js";

// Networks & topic metadata
export {
  NETWORK_DEFAULTS,
  GITHUB_PAY_MAINNET,
  GITHUB_PAY_TESTNET,
  TOPIC_NAMES,
  TOPIC_MEMOS,
  hashscanBase,
  mirrorBase,
  topicHashscanUrl,
  transactionHashscanUrl,
} from "./networks.js";
export type { HederaNetwork, GithubPayNetworkDefaults } from "./networks.js";

// Tool classes & singletons
export { GithubPayTool } from "./tools/base.js";
export { RegisterContributorTool, registerContributorTool } from "./tools/registerContributor.js";
export { SetPaymentPolicyTool, setPaymentPolicyTool } from "./tools/setPaymentPolicy.js";
export { SetPaymentCapTool, setPaymentCapTool } from "./tools/setPaymentCap.js";
export { PayOnMergeTool, payOnMergeTool } from "./tools/payOnMerge.js";
export {
  QueryContributorPaymentsTool,
  queryContributorPaymentsTool,
} from "./tools/queryContributorPayments.js";
export {
  SealReleaseProvenanceTool,
  sealReleaseProvenanceTool,
} from "./tools/sealReleaseProvenance.js";
export { QueryTeamSummaryTool, queryTeamSummaryTool } from "./tools/queryTeamSummary.js";

// Core domain logic (reusable outside the agent loop, e.g. the webhook server)
export {
  payOnMerge,
  sealReleaseProvenance,
  notifySlack,
  type PayOnMergeInput,
  type PayOnMergeResult,
  type ReleaseInput,
} from "./pay.js";
export {
  loadStore,
  saveStore,
  ensureTopics,
  getTopicId,
  submitMessage,
  readTopicMessages,
  topicMessageCount,
} from "./hcs.js";
export {
  resolveContributor,
  resolvePolicyRule,
  resolveCap,
  getAllReceipts,
  findReceiptForPr,
} from "./resolve.js";
export { toCsv } from "./csv.js";

// HCS payload & store types
export type {
  TopicName,
  Store,
  IdentityRecord,
  PolicyRule,
  PaymentCap,
  Receipt,
  ReleaseProvenance,
  SealResult,
} from "./types.js";

// App helpers (webhook server + agent loop)
export { createWebhookServer, verifySignature } from "./server.js";
export type { WebhookServerOptions } from "./server.js";
export {
  createGithubPayAgent,
  initTopics,
  runAgentTurn,
  type GithubPayAgent,
} from "./agent.js";
