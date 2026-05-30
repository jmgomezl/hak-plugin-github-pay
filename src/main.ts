#!/usr/bin/env node
import "dotenv/config";
import * as readline from "node:readline";
import { createGithubPayAgent, initTopics, runAgentTurn } from "./agent.js";
import { topicHashscanUrl } from "./networks.js";
import { createWebhookServer } from "./server.js";

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing environment variable: ${key}`);
  return val;
}

async function main() {
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const agent = createGithubPayAgent({
    accountId: getEnv("HEDERA_ACCOUNT_ID"),
    privateKey: getEnv("HEDERA_PRIVATE_KEY"),
    network,
    geminiApiKey: getEnv("GEMINI_API_KEY"),
    githubToken: process.env.GITHUB_TOKEN || undefined,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || undefined,
    policyAdminKey: process.env.POLICY_ADMIN_KEY || undefined,
  });

  console.log("⛓  github-pay — provisioning HCS topics…");
  const topics = await initTopics(agent);
  for (const [name, id] of Object.entries(topics)) {
    console.log(`   ${name.padEnd(10)} ${id}  ${topicHashscanUrl(network, id)}`);
  }

  // Start the webhook server (HMAC-validated GitHub events + /health).
  const port = Number(process.env.PORT ?? 3000);
  const server = createWebhookServer({
    agent,
    webhookSecret: getEnv("GITHUB_WEBHOOK_SECRET"),
    githubToken: process.env.GITHUB_TOKEN || undefined,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || undefined,
  });
  server.listen(port, () => {
    console.log(`\n🌐 webhook server listening on http://localhost:${port}`);
    console.log("   POST /webhook   (GitHub events — HMAC validated)");
    console.log("   GET  /health    (topic connectivity + last operation)\n");
  });

  // Optional interactive agent REPL (skip with NO_REPL=1, e.g. under PM2).
  if (process.env.NO_REPL === "1" || !process.stdin.isTTY) {
    console.log("Running headless (no REPL). Webhook server is live.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    "Type a request for the agent (e.g. \"register @octocat as 0.0.1234\"), or 'exit'.\n",
  );
  const ask = () =>
    rl.question("github-pay > ", async (line) => {
      const input = line.trim();
      if (!input) return ask();
      if (input.toLowerCase() === "exit") return rl.close();
      try {
        const reply = await runAgentTurn(agent, input);
        console.log(`\n${reply}\n`);
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
      }
      ask();
    });
  rl.on("close", () => {
    console.log("\nbye.");
    process.exit(0);
  });
  ask();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
