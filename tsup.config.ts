import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    plugin: "src/plugin.ts",
    server: "src/server.ts",
    main: "src/main.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  treeshake: true,
  external: [
    "@hashgraph/hedera-agent-kit",
    "@hiero-ledger/sdk",
    "@google/generative-ai",
    "express",
    "zod",
    "dotenv",
  ],
});
