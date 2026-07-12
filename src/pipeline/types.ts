export type SourceName = "dealer-feed-a" | "marketplace-b";

/** Shape after bronze parsing + (for Source B) French field-name mapping — still raw/unvalidated. */
export interface RawCanonicalRecord {
  vin?: unknown;
  sellerId?: unknown;
  stockNumber?: unknown;
  price?: unknown;
  currency?: unknown;
  odometer?: unknown;
  make?: unknown;
  model?: unknown;
  year?: unknown;
  trim?: unknown;
  bodyStyle?: unknown;
  fuelType?: unknown;
  exteriorColor?: unknown;
  interiorColor?: unknown;
  condition?: unknown;
  province?: unknown;
  city?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  listedAt?: unknown;
  status?: unknown;
}

/** Passed structural validation: VIN is 17 chars with a correct check digit, year is sane. */
export interface ValidatedRecord {
  source: SourceName;
  batchId: string;
  vin: string;
  sellerId: string | null;
  stockNumber: string | null;
  rawYear: number;
  raw: RawCanonicalRecord; // kept for listings.raw_payload
}

export interface QuarantinedRecord {
  source: SourceName;
  batchId: string;
  raw: unknown;
  reasonCodes: string[];
}

/** After normalize: prices in cents, odometer in km, canonical trim, still one row per source observation. */
export interface NormalizedRecord {
  source: SourceName;
  batchId: string;
  vin: string;
  sellerId: string | null;
  stockNumber: string | null;
  priceCents: number | null;
  priceWasMalformed: boolean;
  odometerKm: number | null;
  odometerWasConvertedFromMiles: boolean;
  make: string | null;
  model: string | null;
  rawYear: number;
  trim: string | null;
  trimMatched: boolean;
  bodyStyle: string | null;
  fuelType: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  condition: string | null;
  province: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  listedAt: string | null;
  status: string | null;
  raw: RawCanonicalRecord;
}

export interface StageMetrics {
  stage: string;
  source: SourceName;
  batchId: string;
  rowsIn: number;
  rowsOut: number;
  rejects: number;
  startedAt: Date;
  finishedAt: Date;
  extraMetrics: Record<string, number>;
}
