import { describe, it, expect } from "vitest";
import { computeCheckDigit, isValidCheckDigit, buildVin, modelYearToCode } from "./vin.js";

describe("computeCheckDigit", () => {
  it("matches the real VIN captured from the Cardog API (2013 VW Passat)", () => {
    // reference/real-listings.json listing[0].vin === "1VWBH7A30DC104945"
    expect(computeCheckDigit("1VWBH7A30DC104945")).toBe("0");
    expect(isValidCheckDigit("1VWBH7A30DC104945")).toBe(true);
  });

  it("detects a corrupted check digit", () => {
    expect(isValidCheckDigit("1VWBH7A31DC104945")).toBe(false);
  });

  it("detects wrong-length VINs", () => {
    expect(isValidCheckDigit("1VWBH7A30DC10494")).toBe(false);
    expect(isValidCheckDigit("1VWBH7A30DC1049455")).toBe(false);
  });

  it("returns X for a remainder of 10", () => {
    // Known public example VIN with check digit 'X': 1M8GDM9AXKP042788
    expect(computeCheckDigit("1M8GDM9AXKP042788")).toBe("X");
  });

  it("rejects invalid VIN characters (I, O, Q)", () => {
    expect(() => computeCheckDigit("1VWBH7AI0DC104945")).toThrow();
  });
});

describe("modelYearToCode", () => {
  it("encodes 2013 as D, matching the reference VIN", () => {
    expect(modelYearToCode(2013)).toBe("D");
  });

  it("repeats the 30-year cycle (1990 and 2020 share a code)", () => {
    expect(modelYearToCode(1990)).toBe(modelYearToCode(2020));
  });
});

describe("buildVin", () => {
  it("always produces a self-consistent, valid check digit", () => {
    for (let i = 0; i < 50; i++) {
      const vin = buildVin({
        wmi: "1VW",
        vds: "BH7A3",
        modelYear: 2013 + (i % 15),
        plant: "D",
        serial: String(100000 + i).padStart(6, "0"),
      });
      expect(vin).toHaveLength(17);
      expect(isValidCheckDigit(vin)).toBe(true);
    }
  });
});
