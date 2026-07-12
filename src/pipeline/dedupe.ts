import type { NormalizedRecord } from "./types.js";

/**
 * Groups normalized records by VIN to build one merged "vehicle candidate"
 * per VIN — richest-record-fills-gaps survivorship for vehicle-level
 * attributes (make/model/trim/etc). This does NOT discard any individual
 * listing: every (source, stockNumber) observation still becomes its own
 * row in `listings` at load time — cross-posted ads for the same VIN are
 * legitimately separate listings, not duplicates to drop. "Freshest price
 * wins" and "same VIN re-seen with a new price = price_history row" are
 * handled at load time, against the DB's existing state, not here — this
 * stage only resolves what a single run/batch already knows about a VIN.
 */

export interface SurvivorAttributes {
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyStyle: string | null;
  fuelType: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  condition: string | null;
}

export interface VehicleCandidate {
  vin: string;
  survivor: SurvivorAttributes;
  claimedYears: number[]; // distinct years different records claimed for this VIN
  hasCrossSourceYearConflict: boolean;
  listings: NormalizedRecord[]; // every individual observation, unmodified — all get loaded
}

const OPTIONAL_FIELDS = [
  "make", "model", "trim", "bodyStyle", "fuelType", "exteriorColor", "interiorColor", "condition",
] as const;

function completeness(r: NormalizedRecord): number {
  let score = 0;
  for (const field of OPTIONAL_FIELDS) if (r[field] !== null) score++;
  if (r.priceCents !== null) score++;
  if (r.odometerKm !== null) score++;
  return score;
}

function mergeSurvivor(records: NormalizedRecord[]): SurvivorAttributes {
  // Richest record first, ties broken by most-recently-listed.
  const sorted = [...records].sort((a, b) => {
    const scoreDiff = completeness(b) - completeness(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.listedAt ?? "").localeCompare(a.listedAt ?? "");
  });

  const survivor = {} as SurvivorAttributes;
  for (const field of OPTIONAL_FIELDS) {
    survivor[field] = null;
    for (const record of sorted) {
      if (record[field] !== null) {
        survivor[field] = record[field];
        break;
      }
    }
  }
  return survivor;
}

export function dedupeByVin(records: NormalizedRecord[]): Map<string, VehicleCandidate> {
  const groups = new Map<string, NormalizedRecord[]>();
  for (const record of records) {
    const group = groups.get(record.vin);
    if (group) group.push(record);
    else groups.set(record.vin, [record]);
  }

  const candidates = new Map<string, VehicleCandidate>();
  for (const [vin, group] of groups) {
    const claimedYears = [...new Set(group.map((r) => r.rawYear))];
    candidates.set(vin, {
      vin,
      survivor: mergeSurvivor(group),
      claimedYears,
      hasCrossSourceYearConflict: claimedYears.length > 1,
      listings: group,
    });
  }
  return candidates;
}
