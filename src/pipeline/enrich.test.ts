import { describe, it, expect, vi } from "vitest";
import type { DecodeResult } from "@cardog/corgi";
import { enrichVehicles, vinPrefix } from "./enrich.js";
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

function fakeDecodeResult(vin: string, vehicle: NonNullable<DecodeResult["components"]["vehicle"]>): DecodeResult {
  return {
    vin,
    valid: true,
    components: { vehicle },
    errors: [],
  };
}

describe("vinPrefix", () => {
  it("takes the first 11 characters", () => {
    expect(vinPrefix("1VWBH7A30DC104945")).toBe("1VWBH7A30DC");
    expect(vinPrefix("1VWBH7A30DC104945")).toHaveLength(11);
  });
});

describe("enrichVehicles", () => {
  it("calls corgi decode once per unique 11-char prefix, not once per VIN", async () => {
    // two VINs sharing a prefix (differ only in serial 12-17)
    const records = [
      makeRecord({ vin: "1VWBH7A30DC104945", stockNumber: "STK1" }),
      makeRecord({ vin: "1VWBH7A30DC999999", stockNumber: "STK2" }),
    ];
    const candidates = dedupeByVin(records);
    const decode = vi.fn(async (vin: string) => fakeDecodeResult(vin, { make: "Volkswagen", model: "Passat", year: 2013 }));
    const { metrics } = await enrichVehicles(candidates, {
      decode,
      cacheGet: async () => new Map(),
      cacheSet: async () => {},
    });
    expect(decode).toHaveBeenCalledTimes(1); // memoized by prefix
    expect(metrics.uniqueVins).toBe(2);
    expect(metrics.uniquePrefixes).toBe(1);
    expect(metrics.corgiCallsMade).toBe(1);
  });

  it("uses the DB cache instead of calling decode when the prefix is already cached", async () => {
    const records = [makeRecord({ vin: "1VWBH7A30DC104945" })];
    const candidates = dedupeByVin(records);
    const cached = fakeDecodeResult("1VWBH7A30DC104945", { make: "Volkswagen", model: "Passat", year: 2013 });
    const decode = vi.fn();
    const { metrics } = await enrichVehicles(candidates, {
      decode,
      cacheGet: async () => new Map([[vinPrefix(records[0]!.vin), cached]]),
      cacheSet: async () => {},
    });
    expect(decode).not.toHaveBeenCalled();
    expect(metrics.cacheHits).toBe(1);
    expect(metrics.corgiCallsMade).toBe(0);
  });

  it("trusts the decode over a source-claimed year and flags the listing", async () => {
    const records = [makeRecord({ vin: "1VWBH7A30DC104945", rawYear: 2015 })]; // source claims 2015
    const candidates = dedupeByVin(records);
    const decode = async () => fakeDecodeResult("1VWBH7A30DC104945", { make: "Volkswagen", model: "Passat", year: 2013 }); // decode says 2013
    const { vehicles, metrics } = await enrichVehicles(candidates, { decode, cacheGet: async () => new Map(), cacheSet: async () => {} });
    expect(vehicles[0]!.modelYear).toBe(2013); // decode wins
    expect(vehicles[0]!.listings[0]!.yearConflict).toBe(true); // but flagged
    expect(metrics.yearConflictListingCount).toBe(1);
  });

  it("falls back to survivor attributes when decode is invalid, and never crashes", async () => {
    const records = [makeRecord({ vin: "1VWBH7A30DC104945", make: "Volkswagen", model: "Passat" })];
    const candidates = dedupeByVin(records);
    const invalidResult: DecodeResult = { vin: records[0]!.vin, valid: false, components: {}, errors: [] };
    const { vehicles, metrics } = await enrichVehicles(candidates, {
      decode: async () => invalidResult,
      cacheGet: async () => new Map(),
      cacheSet: async () => {},
    });
    expect(vehicles[0]!.decodeSource).toBe("undecoded");
    expect(vehicles[0]!.make).toBe("Volkswagen"); // fell back to survivor
    expect(metrics.decodeSuccessCount).toBe(0);
  });

  it("tracks make/model agreement between decode and source claim", async () => {
    const records = [makeRecord({ vin: "1VWBH7A30DC104945", make: "Toyota", model: "Corolla" })]; // source claims Toyota Corolla
    const candidates = dedupeByVin(records);
    const decode = async () => fakeDecodeResult(records[0]!.vin, { make: "Toyota", model: "Prius", year: 2015 }); // decode says Prius
    const { metrics } = await enrichVehicles(candidates, { decode, cacheGet: async () => new Map(), cacheSet: async () => {} });
    expect(metrics.makeModelAgreementChecked).toBe(1);
    expect(metrics.makeModelAgreementCount).toBe(0); // disagreement
  });

  it("falls back to the source value when corgi decodes a field as an empty string (not just undefined)", async () => {
    // corgi's own runtime behavior for an unmatched pattern (confirmed against
    // a real generated VIN): valid=true, but vehicle.model === "" — not
    // undefined. "" must not silently beat a real source-claimed value.
    const records = [makeRecord({ vin: "2HGFC2F52RH488023", make: "Honda", model: "Civic" })];
    const candidates = dedupeByVin(records);
    const decode = async () => fakeDecodeResult("2HGFC2F52RH488023", { make: "Honda", model: "", year: 2024 });
    const { vehicles } = await enrichVehicles(candidates, { decode, cacheGet: async () => new Map(), cacheSet: async () => {} });
    expect(vehicles[0]!.model).toBe("Civic"); // fell back, not ""
  });

  it("persists newly-decoded prefixes via cacheSet", async () => {
    const records = [makeRecord({ vin: "1VWBH7A30DC104945" })];
    const candidates = dedupeByVin(records);
    const cacheSet = vi.fn(async () => {});
    await enrichVehicles(candidates, {
      decode: async (vin) => fakeDecodeResult(vin, { make: "Volkswagen", model: "Passat", year: 2013 }),
      cacheGet: async () => new Map(),
      cacheSet,
    });
    expect(cacheSet).toHaveBeenCalledWith([{ prefix: vinPrefix(records[0]!.vin), decoded: expect.any(Object) }]);
  });
});
