import { describe, it, expect } from "vitest";
import { validateBatch } from "./validate.js";
import { corruptCheckDigit, corruptLength } from "../generator/filth.js";
import { createRng } from "../generator/rng.js";

const GOOD_VIN = "1VWBH7A30DC104945";

describe("validateBatch", () => {
  it("passes a structurally valid record", () => {
    const { valid, quarantined } = validateBatch(
      [{ vin: GOOD_VIN, year: 2013, sellerId: "s1", stockNumber: "STK1" }],
      "dealer-feed-a",
      "batch-0"
    );
    expect(valid).toHaveLength(1);
    expect(quarantined).toHaveLength(0);
    expect(valid[0]!.vin).toBe(GOOD_VIN);
  });

  it("quarantines a missing VIN with reason code", () => {
    const { quarantined } = validateBatch([{ year: 2013 }], "dealer-feed-a", "batch-0");
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]!.reasonCodes).toContain("vin_missing");
  });

  it("quarantines a corrupted check digit (generator's own filth fn) with reason code", () => {
    const rng = createRng(3);
    const bad = corruptCheckDigit(GOOD_VIN, rng);
    const { quarantined, valid } = validateBatch([{ vin: bad, year: 2013 }], "dealer-feed-a", "batch-0");
    expect(valid).toHaveLength(0);
    expect(quarantined[0]!.reasonCodes).toContain("vin_bad_check_digit");
  });

  it("quarantines a wrong-length VIN (generator's own filth fn) with reason code", () => {
    const rng = createRng(9);
    const bad = corruptLength(GOOD_VIN, rng);
    const { quarantined } = validateBatch([{ vin: bad, year: 2013 }], "dealer-feed-a", "batch-0");
    expect(quarantined[0]!.reasonCodes).toContain("vin_wrong_length");
  });

  it("quarantines missing year separately from VIN problems", () => {
    const { quarantined } = validateBatch([{ vin: GOOD_VIN }], "dealer-feed-a", "batch-0");
    expect(quarantined[0]!.reasonCodes).toEqual(["year_missing"]);
  });

  it("quarantines an out-of-range year", () => {
    const { quarantined } = validateBatch([{ vin: GOOD_VIN, year: 1899 }], "dealer-feed-a", "batch-0");
    expect(quarantined[0]!.reasonCodes).toContain("year_out_of_range");
  });

  it("can attach multiple reason codes to one record", () => {
    const { quarantined } = validateBatch([{ vin: "bad", year: 1899 }], "dealer-feed-a", "batch-0");
    expect(quarantined[0]!.reasonCodes).toEqual(expect.arrayContaining(["vin_wrong_length", "year_out_of_range"]));
    expect(quarantined[0]!.reasonCodes).toHaveLength(2);
  });

  it("never throws on a completely empty record", () => {
    expect(() => validateBatch([{}], "dealer-feed-a", "batch-0")).not.toThrow();
  });
});
