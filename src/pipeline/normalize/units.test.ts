import { describe, it, expect } from "vitest";
import { normalizeOdometer } from "./units.js";
import { kmToMiles } from "../../generator/filth.js";

describe("normalizeOdometer", () => {
  it("passes through Source A values untouched (never assumed to be miles)", () => {
    const result = normalizeOdometer(90000, 2018, 2026, { assumeSourceBMayBeMiles: false });
    expect(result.odometerKm).toBe(90000);
    expect(result.wasConvertedFromMiles).toBe(false);
  });

  it("catches a clearly-mislabeled low-mileage case (true rate well under threshold)", () => {
    // true km = 40000 over 8 years = 5000 km/year (already low); mislabeled as miles
    // the field would show kmToMiles(40000) and read as if that were km.
    const trueKm = 40000;
    const disguisedAsKm = kmToMiles(trueKm); // 24855
    const result = normalizeOdometer(disguisedAsKm, 2018, 2026, { assumeSourceBMayBeMiles: true });
    expect(result.wasConvertedFromMiles).toBe(true);
    expect(result.odometerKm).toBe(Math.round(disguisedAsKm * 1.60934));
  });

  it("does NOT catch a high-true-mileage secretly-miles case (known heuristic limitation)", () => {
    // true km = 200000 over 8 years = 25000 km/year (high); once relabeled as
    // miles the apparent rate is still ~15.5k/year, which reads as plausible
    // km — this is the documented false-negative gap, asserted explicitly
    // so a future change to the threshold doesn't silently alter behavior.
    const trueKm = 200000;
    const disguisedAsKm = kmToMiles(trueKm);
    const result = normalizeOdometer(disguisedAsKm, 2018, 2026, { assumeSourceBMayBeMiles: true });
    expect(result.wasConvertedFromMiles).toBe(false);
    expect(result.odometerKm).toBe(disguisedAsKm);
  });

  it("leaves a normal, already-in-km Source B value alone", () => {
    const result = normalizeOdometer(120000, 2018, 2026, { assumeSourceBMayBeMiles: true }); // 15k/year, plausible
    expect(result.wasConvertedFromMiles).toBe(false);
    expect(result.odometerKm).toBe(120000);
  });

  it("handles missing/invalid values without throwing", () => {
    expect(normalizeOdometer(null, 2018, 2026, { assumeSourceBMayBeMiles: true }).odometerKm).toBeNull();
    expect(normalizeOdometer("n/a", 2018, 2026, { assumeSourceBMayBeMiles: true }).odometerKm).toBeNull();
    expect(normalizeOdometer(-5, 2018, 2026, { assumeSourceBMayBeMiles: true }).odometerKm).toBeNull();
  });
});
