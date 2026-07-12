import { describe, it, expect } from "vitest";
import { parsePrice } from "./price.js";
import { formatPriceDollarComma, formatPriceQuebec } from "../../generator/filth.js";

describe("parsePrice", () => {
  it("handles a plain number (Source A common case)", () => {
    expect(parsePrice(24999).priceCents).toBe(2499900);
  });

  it("handles dollar-comma strings, matching the generator's own formatter", () => {
    const raw = formatPriceDollarComma(34999); // "$34,999"
    const result = parsePrice(raw);
    expect(result.priceCents).toBe(3499900);
    expect(result.wasMalformed).toBe(true);
  });

  it("handles Quebec-format strings, matching the generator's own formatter", () => {
    const raw = formatPriceQuebec(35995); // "35 995 $"
    const result = parsePrice(raw);
    expect(result.priceCents).toBe(3599500);
    expect(result.wasMalformed).toBe(true);
  });

  it("treats missing/null/empty as null, not an error", () => {
    expect(parsePrice(null).priceCents).toBeNull();
    expect(parsePrice(undefined).priceCents).toBeNull();
    expect(parsePrice("").priceCents).toBeNull();
  });

  it("treats unparseable garbage as null but flags it malformed", () => {
    const result = parsePrice("call for price");
    expect(result.priceCents).toBeNull();
    expect(result.wasMalformed).toBe(true);
  });

  it("handles a huge absurd outlier without throwing", () => {
    expect(parsePrice(9_999_999).priceCents).toBe(999_999_900);
  });
});
