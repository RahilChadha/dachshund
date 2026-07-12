import { parsePrice } from "./price.js";
import { normalizeOdometer } from "./units.js";
import { canonicalizeTrim } from "./trim.js";
import type { ValidatedRecord, NormalizedRecord } from "../types.js";

const REFERENCE_YEAR = new Date().getFullYear();

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeRecord(record: ValidatedRecord): NormalizedRecord {
  const { raw, source } = record;

  const priceResult = parsePrice(raw.price);
  const make = str(raw.make);
  const model = str(raw.model);

  const odometerResult = normalizeOdometer(raw.odometer, record.rawYear, REFERENCE_YEAR, {
    assumeSourceBMayBeMiles: source === "marketplace-b",
  });

  const trimResult = canonicalizeTrim(str(raw.trim), make ?? "", model ?? "");

  return {
    source,
    batchId: record.batchId,
    vin: record.vin,
    sellerId: record.sellerId,
    stockNumber: record.stockNumber,
    priceCents: priceResult.priceCents,
    priceWasMalformed: priceResult.wasMalformed,
    odometerKm: odometerResult.odometerKm,
    odometerWasConvertedFromMiles: odometerResult.wasConvertedFromMiles,
    make,
    model,
    rawYear: record.rawYear,
    trim: trimResult.trim,
    trimMatched: trimResult.matched,
    bodyStyle: str(raw.bodyStyle),
    fuelType: str(raw.fuelType),
    exteriorColor: str(raw.exteriorColor),
    interiorColor: str(raw.interiorColor),
    condition: str(raw.condition),
    province: str(raw.province),
    city: str(raw.city),
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    listedAt: str(raw.listedAt),
    status: str(raw.status),
    raw,
  };
}

export function normalizeBatch(records: ValidatedRecord[]): NormalizedRecord[] {
  return records.map(normalizeRecord);
}
