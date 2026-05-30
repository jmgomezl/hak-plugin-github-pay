import { describe, expect, it } from "vitest";
import { githubPayPlugin, githubPayPluginToolNames } from "../src/plugin";

describe("githubPayPlugin", () => {
  const tools = githubPayPlugin.tools({ accountId: "0.0.1" } as never);

  it("exposes the expected metadata", () => {
    expect(githubPayPlugin.name).toBe("github-pay");
    expect(githubPayPlugin.description).toMatch(/HBAR/);
  });

  it("registers all seven tools", () => {
    expect(tools).toHaveLength(7);
  });

  it("namespaces every tool method with github_pay_ (collision-safe)", () => {
    for (const tool of tools) {
      expect(tool.method).toMatch(/^github_pay_[a-z_]+$/);
    }
  });

  it("uses Gemini-safe method names and human-readable names", () => {
    for (const tool of tools) {
      expect(tool.method).toMatch(/^[a-zA-Z0-9_]+$/); // valid as a Gemini function name
      expect(tool.name).toMatch(/^GitHub Pay: /);
      expect(typeof tool.description).toBe("string");
    }
  });

  it("gives every tool a zod object schema", () => {
    for (const tool of tools) {
      expect(typeof tool.parameters.parse).toBe("function");
    }
  });

  it("keeps the tool-name constants in sync with the registered tools", () => {
    const declared = Object.values(githubPayPluginToolNames).sort();
    const actual = tools.map((t) => t.method).sort();
    expect(actual).toEqual(declared);
  });
});
