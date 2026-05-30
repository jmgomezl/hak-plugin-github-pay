import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server.ts",
    "src/plugin/githubPayPlugin.ts",
  ],
  format: ["esm"],
  target: "node20",
  outDir: "dist/esm",
  outExtension: () => ({ js: ".mjs" }),
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  external: [
    "@hashgraph/hedera-agent-kit",
    "@hiero-ledger/sdk",
    "@google/generative-ai",
    "express",
    "zod",
    "dotenv",
  ],
});
