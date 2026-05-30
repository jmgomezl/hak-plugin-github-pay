import { describe, expect, it } from "vitest";
import { parsePrivateKey } from "../src/keys";

describe("parsePrivateKey", () => {
  it("parses a raw ECDSA hex key and exposes a public key", () => {
    const hex = "f4ac96bb66601aefff46acdb76c31f5b5036d7b72a60503d2f1e355d8f4e6759";
    const key = parsePrivateKey(hex);
    expect(key.publicKey).toBeDefined();
  });

  it("tolerates a leading 0x", () => {
    const hex = "0xf4ac96bb66601aefff46acdb76c31f5b5036d7b72a60503d2f1e355d8f4e6759";
    expect(parsePrivateKey(hex).publicKey.toString().length).toBeGreaterThan(0);
  });

  it("derives the same public key with or without the 0x prefix", () => {
    const raw = "f4ac96bb66601aefff46acdb76c31f5b5036d7b72a60503d2f1e355d8f4e6759";
    expect(parsePrivateKey(raw).publicKey.toString()).toBe(
      parsePrivateKey(`0x${raw}`).publicKey.toString(),
    );
  });
});
