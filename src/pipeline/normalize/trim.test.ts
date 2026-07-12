import { describe, it, expect } from "vitest";
import { canonicalizeTrim } from "./trim.js";
import { trimVariant } from "../../generator/filth.js";
import { createRng } from "../../generator/rng.js";

describe("canonicalizeTrim", () => {
  it("matches an exact canonical trim", () => {
    expect(canonicalizeTrim("EX-L", "Honda", "Accord")).toEqual({ trim: "EX-L", matched: true });
  });

  it("matches every variant the generator's own trimVariant() can produce", () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const variant = trimVariant("EX-L", rng);
      const result = canonicalizeTrim(variant, "Honda", "Accord");
      expect(result.matched, `variant "${variant}" should have matched`).toBe(true);
      expect(result.trim).toBe("EX-L");
    }
  });

  it("is case- and punctuation-insensitive", () => {
    expect(canonicalizeTrim("exl", "Honda", "Accord").matched).toBe(true);
    expect(canonicalizeTrim("EX L", "Honda", "Accord").matched).toBe(true);
  });

  it("returns unmatched (but non-null) for a make/model it doesn't recognize", () => {
    const result = canonicalizeTrim("Some Trim", "Yugo", "GV");
    expect(result.matched).toBe(false);
    expect(result.trim).toBe("Some Trim");
  });

  it("returns null for missing trim", () => {
    expect(canonicalizeTrim(null, "Honda", "Accord")).toEqual({ trim: null, matched: false });
    expect(canonicalizeTrim("", "Honda", "Accord")).toEqual({ trim: null, matched: false });
  });
});
