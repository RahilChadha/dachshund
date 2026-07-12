import { describe, it, expect } from "vitest";
import { createRng } from "./rng.js";
import { formatPriceDollarComma, formatPriceQuebec, corruptCheckDigit, corruptLength, kmToMiles } from "./filth.js";
import { isValidCheckDigit } from "./vin.js";

describe("price formatting", () => {
  it("formats dollar-comma style", () => {
    expect(formatPriceDollarComma(34999)).toBe("$34,999");
  });

  it("formats Quebec style with space separators and trailing $", () => {
    expect(formatPriceQuebec(35995)).toBe("35 995 $");
  });
});

describe("corruptCheckDigit", () => {
  it("always produces a different, invalid check digit", () => {
    const rng = createRng(42);
    const vin = "1VWBH7A30DC104945"; // valid, check digit '0'
    for (let i = 0; i < 20; i++) {
      const corrupted = corruptCheckDigit(vin, rng);
      expect(corrupted[8]).not.toBe("0");
      expect(isValidCheckDigit(corrupted)).toBe(false);
      expect(corrupted).toHaveLength(17);
    }
  });
});

describe("corruptLength", () => {
  it("always changes the VIN to something other than 17 chars", () => {
    const rng = createRng(7);
    const vin = "1VWBH7A30DC104945";
    for (let i = 0; i < 20; i++) {
      expect(corruptLength(vin, rng)).not.toHaveLength(17);
    }
  });
});

describe("kmToMiles", () => {
  it("converts using the standard factor", () => {
    expect(kmToMiles(100000)).toBe(62137);
  });
});
