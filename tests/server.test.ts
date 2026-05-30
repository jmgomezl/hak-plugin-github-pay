import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/server";

const secret = "topsecret";
const body = Buffer.from(JSON.stringify({ action: "closed", merged: true }));

function sign(s: string, b: Buffer): string {
  return `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;
}

describe("verifySignature (X-Hub-Signature-256)", () => {
  it("accepts a correct HMAC", () => {
    expect(verifySignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifySignature(secret, body, sign("nope", body))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ action: "closed", merged: false }));
    expect(verifySignature(secret, tampered, sign(secret, body))).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature(secret, body, undefined)).toBe(false);
  });

  it("rejects a malformed signature without length leak", () => {
    expect(verifySignature(secret, body, "sha256=deadbeef")).toBe(false);
  });
});
