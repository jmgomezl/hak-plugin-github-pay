import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  TOPIC_NAMES,
  TOPIC_MEMOS,
  type Store,
  type TopicName,
  type SealResult,
} from "./types.js";

const STORE_PATH = resolve(process.cwd(), "store.json");

// ─── store.json — same loadStore/saveStore pattern as AICourt's cases.json ─────

export function loadStore(): Store {
  if (!existsSync(STORE_PATH)) {
    const initial: Store = {
      topics: { IDENTITIES: null, POLICIES: null, RECEIPTS: null, RELEASES: null },
      lastOperation: null,
    };
    writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as Store;
}

export function saveStore(store: Store): void {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function recordOperation(tool: string, detail: string): void {
  const store = loadStore();
  store.lastOperation = { tool, timestamp: new Date().toISOString(), detail };
  saveStore(store);
}

// ─── Topic provisioning ───────────────────────────────────────────────────────

async function createTopic(client: Client, name: TopicName): Promise<string> {
  const tx = new TopicCreateTransaction().setTopicMemo(TOPIC_MEMOS[name]);
  const receipt = await (await tx.execute(client)).getReceipt(client);
  return receipt.topicId!.toString();
}

/**
 * Ensure all four HCS topics exist. Any topic whose ID is missing from
 * store.json is created on-chain and persisted. Idempotent: existing topics are
 * left untouched. Returns the resolved topic map.
 */
export async function ensureTopics(
  client: Client
): Promise<Record<TopicName, string>> {
  const store = loadStore();
  let mutated = false;

  for (const name of TOPIC_NAMES) {
    if (!store.topics[name]) {
      store.topics[name] = await createTopic(client, name);
      mutated = true;
    }
  }

  if (mutated) saveStore(store);
  return store.topics as Record<TopicName, string>;
}

export function getTopicId(name: TopicName): string {
  const store = loadStore();
  const id = store.topics[name];
  if (!id) {
    throw new Error(
      `HCS topic ${name} has not been provisioned yet. Start the agent/server once to run ensureTopics().`
    );
  }
  return id;
}

// ─── Hashscan / mirror node helpers ───────────────────────────────────────────

export function hashscanBase(network: string): string {
  return network === "mainnet"
    ? "https://hashscan.io/mainnet"
    : "https://hashscan.io/testnet";
}

export function mirrorBase(network: string): string {
  return network === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

export function topicHashscanUrl(network: string, topicId: string): string {
  return `${hashscanBase(network)}/topic/${topicId}`;
}

// ─── Write a JSON message to a topic ──────────────────────────────────────────

export async function submitMessage(
  client: Client,
  network: string,
  topicName: TopicName,
  payload: unknown
): Promise<SealResult> {
  const topicId = getTopicId(topicName);
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify(payload));

  const receipt = await (await tx.execute(client)).getReceipt(client);
  const sequenceNumber = receipt.topicSequenceNumber?.toString() ?? "unknown";

  return {
    topicId,
    sequenceNumber,
    hashscanUrl: topicHashscanUrl(network, topicId),
  };
}

// ─── Read & reassemble all messages on a topic (handles HCS chunking) ─────────

type MirrorMsg = {
  message: string;
  sequence_number: number;
  consensus_timestamp: string;
  chunk_info?: {
    initial_transaction_id: { account_id: string; transaction_valid_start: string };
    number: number;
    total: number;
  };
};

/**
 * Fetch every message on a topic from the mirror node, reassemble chunked
 * submissions, and return the parsed JSON payloads in chronological order.
 * Malformed / incomplete groups are skipped silently.
 */
export async function readTopicMessages<T = Record<string, unknown>>(
  network: string,
  topicId: string
): Promise<Array<T & { sequenceNumber: number; consensusTimestamp: string }>> {
  const out: Array<T & { sequenceNumber: number; consensusTimestamp: string }> = [];
  let url:
    | string
    | null = `${mirrorBase(network)}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

  // Group chunks across the full paginated result before reassembling.
  const groups = new Map<string, MirrorMsg[]>();

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror node error: ${res.status} for ${url}`);
    const data = (await res.json()) as { messages: MirrorMsg[]; links?: { next?: string | null } };

    for (const m of data.messages) {
      const key = m.chunk_info
        ? `${m.chunk_info.initial_transaction_id.account_id}-${m.chunk_info.initial_transaction_id.transaction_valid_start}`
        : `solo-${m.sequence_number}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    url = data.links?.next ? `${mirrorBase(network)}${data.links.next}` : null;
  }

  for (const chunks of groups.values()) {
    try {
      chunks.sort((a, b) => (a.chunk_info?.number ?? 1) - (b.chunk_info?.number ?? 1));
      const combined = Buffer.concat(chunks.map((c) => Buffer.from(c.message, "base64")));
      const json = JSON.parse(combined.toString("utf-8")) as T;
      out.push({
        ...json,
        sequenceNumber: chunks[0].sequence_number,
        consensusTimestamp: chunks[0].consensus_timestamp,
      });
    } catch {
      // skip malformed / partial groups
    }
  }

  out.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return out;
}

/**
 * Lightweight connectivity probe used by GET /health: returns the number of
 * messages currently visible on a topic, or throws on mirror error.
 */
export async function topicMessageCount(
  network: string,
  topicId: string
): Promise<number> {
  const url = `${mirrorBase(network)}/api/v1/topics/${topicId}/messages?limit=1&order=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror node error: ${res.status}`);
  const data = (await res.json()) as { messages: MirrorMsg[] };
  return data.messages[0]?.sequence_number ?? 0;
}
