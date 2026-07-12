import { describe, it, expect } from "vitest";
import { dedupeByVin } from "./dedupe.js";
import type { NormalizedRecord } from "./types.js";

function makeRecord(overrides: Partial<NormalizedRecord>): NormalizedRecord {
  return {
    source: "dealer-feed-a",
    batchId: "batch-0",
    vin: "1VWBH7A30DC104945",
    sellerId: "seller-1",
    stockNumber: "STK1",
    priceCents: null,
    priceWasMalformed: false,
    odometerKm: null,
    odometerWasConvertedFromMiles: false,
    make: null,
    model: null,
    rawYear: 2013,
    trim: null,
    trimMatched: false,
    bodyStyle: null,
    fuelType: null,
    exteriorColor: null,
    interiorColor: null,
    condition: null,
    province: null,
    city: null,
    latitude: null,
    longitude: null,
    listedAt: null,
    status: null,
    raw: {},
    ...overrides,
  };
}

describe("dedupeByVin", () => {
  it("groups records sharing a VIN into one candidate", () => {
    const records = [makeRecord({ stockNumber: "STK1" }), makeRecord({ stockNumber: "STK2", source: "marketplace-b" })];
    const candidates = dedupeByVin(records);
    expect(candidates.size).toBe(1);
    expect(candidates.get(records[0]!.vin)!.listings).toHaveLength(2);
  });

  it("keeps every listing, even for the same VIN (cross-posted ads are not dropped)", () => {
    const records = [makeRecord({ stockNumber: "STK1" }), makeRecord({ stockNumber: "STK2" })];
    const candidate = dedupeByVin(records).get(records[0]!.vin)!;
    expect(candidate.listings.map((l) => l.stockNumber)).toEqual(["STK1", "STK2"]);
  });

  it("richest record fills gaps: a sparse record borrows fields from a richer one", () => {
    const sparse = makeRecord({ stockNumber: "STK1", make: "Volkswagen", model: "Passat" }); // 2 fields
    const rich = makeRecord({
      stockNumber: "STK2",
      make: "Volkswagen",
      model: "Passat",
      trim: "Comfortline",
      bodyStyle: "sedan",
      fuelType: "gasoline",
      priceCents: 2000000,
      odometerKm: 76559,
    });
    const candidate = dedupeByVin([sparse, rich]).get(sparse.vin)!;
    expect(candidate.survivor.trim).toBe("Comfortline"); // filled from the richer record
    expect(candidate.survivor.make).toBe("Volkswagen");
  });

  it("detects the cross-source contradictory-year overlap the generator injects", () => {
    // mirrors src/generator/index.ts's ~2% VIN overlap: same VIN, different year/price
    const fromA = makeRecord({ source: "dealer-feed-a", stockNumber: "STK1", rawYear: 2013, priceCents: 2000000 });
    const fromB = makeRecord({ source: "marketplace-b", stockNumber: "STK2", rawYear: 2014, priceCents: 2150000 });
    const candidate = dedupeByVin([fromA, fromB]).get(fromA.vin)!;
    expect(candidate.hasCrossSourceYearConflict).toBe(true);
    expect(candidate.claimedYears.sort()).toEqual([2013, 2014]);
  });

  it("does not flag a conflict when all records agree on year", () => {
    const records = [makeRecord({ rawYear: 2013 }), makeRecord({ rawYear: 2013, stockNumber: "STK2" })];
    const candidate = dedupeByVin(records).get(records[0]!.vin)!;
    expect(candidate.hasCrossSourceYearConflict).toBe(false);
  });

  it("handles distinct VINs as separate candidates", () => {
    const records = [makeRecord({ vin: "AAA" }), makeRecord({ vin: "BBB" })];
    expect(dedupeByVin(records).size).toBe(2);
  });
});
