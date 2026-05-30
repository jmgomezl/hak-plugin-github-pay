import { describe, expect, it } from "vitest";
import { toCsv } from "../src/csv";

describe("toCsv", () => {
  it("renders a header and rows", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        [1, "x"],
        [2, "y"],
      ],
    );
    expect(csv).toBe("a,b\n1,x\n2,y");
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = toCsv(
      ["name", "note"],
      [
        ["a,b", 'he said "hi"'],
        ["multi\nline", "ok"],
      ],
    );
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"he said ""hi"""');
    expect(csv).toContain('"multi\nline"');
  });

  it("renders empty cells for null/undefined", () => {
    const csv = toCsv(["x"], [[null], [undefined]]);
    expect(csv).toBe("x\n\n");
  });
});
