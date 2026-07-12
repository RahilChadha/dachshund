import type { VehicleCandidate } from "./dedupe.js";
import type { NormalizedRecord } from "./types.js";

export interface DuplicateConflictMetrics {
  uniqueVins: number;
  vinsWithinSourceDuplicate: number; // same VIN, >1 listing from the SAME source
  vinsCrossSourceDuplicate: number; // same VIN, listings from >1 distinct sources
  vinsWithYearConflict: number;
}

export function computeDuplicateConflictMetrics(candidates: Map<string, VehicleCandidate>): DuplicateConflictMetrics {
  let vinsWithinSourceDuplicate = 0;
  let vinsCrossSourceDuplicate = 0;
  let vinsWithYearConflict = 0;

  for (const candidate of candidates.values()) {
    const countBySource = new Map<string, number>();
    for (const listing of candidate.listings) {
      countBySource.set(listing.source, (countBySource.get(listing.source) ?? 0) + 1);
    }
    if ([...countBySource.values()].some((c) => c > 1)) vinsWithinSourceDuplicate++;
    if (countBySource.size > 1) vinsCrossSourceDuplicate++;
    if (candidate.hasCrossSourceYearConflict) vinsWithYearConflict++;
  }

  return {
    uniqueVins: candidates.size,
    vinsWithinSourceDuplicate,
    vinsCrossSourceDuplicate,
    vinsWithYearConflict,
  };
}

/**
 * Price outliers via per-(make,model) z-score: a listing whose price is
 * more than 3 standard deviations from the mean for its make/model is
 * flagged. Groups with fewer than 5 priced listings are skipped (not
 * enough data for a meaningful stddev).
 */
export function computePriceOutlierRate(records: NormalizedRecord[]): { outliers: number; scored: number } {
  const groups = new Map<string, number[]>();
  for (const r of records) {
    if (r.priceCents === null || !r.make || !r.model) continue;
    const key = `${r.make}|${r.model}`;
    const arr = groups.get(key);
    if (arr) arr.push(r.priceCents);
    else groups.set(key, [r.priceCents]);
  }

  let outliers = 0;
  let scored = 0;
  for (const prices of groups.values()) {
    if (prices.length < 5) continue;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) continue;
    for (const p of prices) {
      scored++;
      if (Math.abs(p - mean) / stddev > 3) outliers++;
    }
  }
  return { outliers, scored };
}
