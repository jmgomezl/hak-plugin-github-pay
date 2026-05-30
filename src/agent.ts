import {
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  GoogleGenerativeAI,
  type Schema,
  SchemaType,
} from "@google/generative-ai";
import { type Context, HederaAgentAPI, type Tool } from "@hashgraph/hedera-agent-kit";
import { AccountId, Client } from "@hiero-ledger/sdk";
import { z } from "zod";
import type { GithubPayConfig } from "./config.js";
import { ensureTopics } from "./hcs.js";
import { parsePrivateKey } from "./keys.js";
import { githubPayPlugin } from "./plugin.js";

export type GithubPayAgent = {
  client: Client;
  api: HederaAgentAPI;
  tools: Tool[];
  network: string;
  payerAccountId: string;
  geminiApiKey: string;
  /** Set when a dedicated POLICIES admin key is configured. */
  policyAdminKey?: string;
};

export function createGithubPayAgent(opts: {
  accountId: string;
  privateKey: string;
  network: string;
  geminiApiKey: string;
  githubToken?: string;
  slackWebhookUrl?: string;
  policyAdminKey?: string;
}): GithubPayAgent {
  const client = opts.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(opts.accountId), parsePrivateKey(opts.privateKey));

  // The tools resolve their config from the HAK Context (resolveGithubPayConfig).
  const githubPay: GithubPayConfig = {
    network: opts.network,
    payerAccountId: opts.accountId,
    githubToken: opts.githubToken,
    slackWebhookUrl: opts.slackWebhookUrl,
    policyAdminKey: opts.policyAdminKey,
  };
  const context = { accountId: opts.accountId, config: { githubPay } } as Context;

  const tools = githubPayPlugin.tools(context);
  const api = new HederaAgentAPI(client, context, tools);

  return {
    client,
    api,
    tools,
    network: opts.network,
    payerAccountId: opts.accountId,
    geminiApiKey: opts.geminiApiKey,
    policyAdminKey: opts.policyAdminKey,
  };
}

/**
 * Provision the 4 HCS topics if they don't exist yet. When a POLICIES admin key
 * is configured, a freshly-created POLICIES topic is locked with it as the
 * submitKey. Returns the topic map.
 */
export async function initTopics(agent: GithubPayAgent) {
  const policyAdminPublicKey = agent.policyAdminKey
    ? parsePrivateKey(agent.policyAdminKey).publicKey
    : undefined;
  return ensureTopics(agent.client, { policyAdminPublicKey });
}

// ─── zod → Gemini function-declaration conversion ─────────────────────────────

function zodToGeminiSchema(zType: z.ZodTypeAny): Schema {
  // Unwrap optionals/defaults/nullables to reach the inner type.
  let inner = zType;
  while (
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodDefault ||
    inner instanceof z.ZodNullable
  ) {
    inner = inner._def.innerType;
  }
  const description = (zType._def as { description?: string }).description;

  if (inner instanceof z.ZodString) {
    return { type: SchemaType.STRING, description };
  }
  if (inner instanceof z.ZodNumber) {
    const isInt = inner._def.checks?.some((c) => c.kind === "int");
    return { type: isInt ? SchemaType.INTEGER : SchemaType.NUMBER, description };
  }
  if (inner instanceof z.ZodBoolean) {
    return { type: SchemaType.BOOLEAN, description };
  }
  if (inner instanceof z.ZodArray) {
    return {
      type: SchemaType.ARRAY,
      description,
      items: zodToGeminiSchema(inner._def.type),
    };
  }
  if (inner instanceof z.ZodObject) {
    return zodObjectToSchema(inner, description);
  }
  // Fallback — treat unknown as string
  return { type: SchemaType.STRING, description };
}

function zodObjectToSchema(obj: z.ZodObject<z.ZodRawShape>, description?: string): Schema {
  const shape = obj.shape;
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToGeminiSchema(value as z.ZodTypeAny);
    const isOptional = value instanceof z.ZodOptional || value instanceof z.ZodDefault;
    if (!isOptional) required.push(key);
  }
  return {
    type: SchemaType.OBJECT,
    description,
    properties,
    required: required.length ? required : undefined,
  };
}

function toFunctionDeclaration(tool: Tool): FunctionDeclaration {
  return {
    // Gemini function names must be alphanumeric/underscore — use the snake-case
    // method id, not the human-readable `name`.
    name: tool.method,
    description: tool.description,
    parameters: zodObjectToSchema(
      tool.parameters as z.ZodObject<z.ZodRawShape>,
    ) as FunctionDeclarationSchema,
  };
}

const SYSTEM_INSTRUCTION = `You are the GitHub-Pay operations agent. You manage on-chain bounty payments on Hedera.

You have tools to:
- register a contributor's GitHub→Hedera identity
- set payment policies and spending caps
- pay a contributor when their PR is merged (idempotent, cap-enforced)
- query payment history and team summaries (CSV)
- seal release provenance (SHA-256 of release assets)

Rules:
- Always use a tool for any on-chain action; never invent transaction ids or topic ids.
- pay_on_merge is idempotent — if it returns "already_paid", report that plainly, do not retry.
- When a tool returns CSV, present it verbatim inside a code block.
- Be concise. Report Hashscan URLs whenever a tool returns one.`;

/**
 * Run one natural-language turn through Gemini 2.5 Flash with function calling.
 * Dispatches any function calls to the HAK tools via HederaAgentAPI.run().
 */
export async function runAgentTurn(
  agent: GithubPayAgent,
  userMessage: string,
  maxSteps = 6,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(agent.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: agent.tools.map(toFunctionDeclaration) }],
  });

  const chat = model.startChat();
  let result = await chat.sendMessage(userMessage);

  for (let step = 0; step < maxSteps; step++) {
    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) {
      return result.response.text();
    }

    const responses = [];
    for (const call of calls) {
      const tool = agent.tools.find((t) => t.method === call.name);
      let output: unknown;
      if (!tool) {
        output = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          output = await agent.api.run(tool.method, call.args);
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      responses.push({
        functionResponse: {
          name: call.name,
          response:
            typeof output === "object" && output !== null ? (output as object) : { result: output },
        },
      });
    }

    result = await chat.sendMessage(responses);
  }

  return result.response.text() || "Reached the maximum number of tool steps.";
}
