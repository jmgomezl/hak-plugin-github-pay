import { describe, expect, it } from "vitest";
import { contributorMonthlySpend, monthlySpend } from "../src/resolve";
import type { Receipt } from "../src/types";

function receipt(over: Partial<Receipt>): Receipt {
  return {
    kind: "receipt",
    repo: "owner/repo",
    prNumber: 1,
    prUrl: "https://example.com/pr/1",
    githubHandle: "alice",
    hederaAccountId: "0.0.100",
    amountHbar: 50,
    label: "bounty-50",
    transactionId: "0.0.1@1.2",
    timestamp: "2026-05-10T00:00:00.000Z",
    ...over,
  };
}

describe("spending-cap math", () => {
  const now = new Date("2026-05-29T00:00:00.000Z");

  it("sums only the current calendar month for a repo", () => {
    const receipts = [
      receipt({ amountHbar: 50, timestamp: "2026-05-01T00:00:00.000Z" }),
      receipt({ amountHbar: 30, timestamp: "2026-05-20T00:00:00.000Z" }),
      receipt({ amountHbar: 99, timestamp: "2026-04-30T00:00:00.000Z" }), // prior month
    ];
    expect(monthlySpend(receipts, "owner/repo", now)).toBe(80);
  });

  it("ignores receipts from other repos", () => {
    const receipts = [receipt({ amountHbar: 50 }), receipt({ amountHbar: 70, repo: "other/repo" })];
    expect(monthlySpend(receipts, "owner/repo", now)).toBe(50);
  });

  it("scopes per-contributor spend by account and month", () => {
    const receipts = [
      receipt({ amountHbar: 50, hederaAccountId: "0.0.100" }),
      receipt({ amountHbar: 25, hederaAccountId: "0.0.100" }),
      receipt({ amountHbar: 40, hederaAccountId: "0.0.200" }),
    ];
    expect(contributorMonthlySpend(receipts, "owner/repo", "0.0.100", now)).toBe(75);
    expect(contributorMonthlySpend(receipts, "owner/repo", "0.0.200", now)).toBe(40);
  });
});
