import type { DecodeResult } from "@cardog/corgi";
import type { VehicleCandidate } from "./dedupe.js";
import type { NormalizedRecord } from "./types.js";

/**
 * Decodes each unique VIN via corgi, memoized by the first 11 characters
 * (WMI+VDS+checkdigit+modelyear+plant — see schema.sql's decode_cache
 * comment). Because the generator draws from ~30 fixed seed vehicles, many
 * distinct VINs share the same 11-char prefix (they only differ in the
 * 12-17 serial suffix), so actual corgi.decode() calls are a small
 * fraction of unique VINs, not one per vehicle.
 *
 * Cardog's real NHTSA-pattern-matched decode is treated as authoritative:
 * where it disagrees with what a listing claimed (year, sometimes even
 * make/model — corgi decodes our fabricated VDS values against real
 * manufacturer patterns, which don't always land on the seed we intended),
 * the decode wins and the listing is flagged, never silently overwritten
 * without a trace.
 */

export interface EnrichedListing extends NormalizedRecord {
  yearConflict: boolean;
}

export interface EnrichedVehicle {
  vin: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  trim: string | null;
  bodyStyle: string | null;
  fuelType: string | null;
  driveTrain: string | null;
  transmission: string | null;
  decodeSource: "corgi" | "undecoded";
  makeModelAgreesWithSource: boolean | null; // null = nothing to compare (no source make/model claimed)
  listings: EnrichedListing[];
}

export interface EnrichDeps {
  decode: (vin: string) => Promise<DecodeResult>;
  cacheGet: (prefixes: string[]) => Promise<Map<string, DecodeResult>>;
  cacheSet: (entries: { prefix: string; decoded: DecodeResult }[]) => Promise<void>;
}

export interface EnrichMetrics {
  uniqueVins: number;
  uniquePrefixes: number;
  cacheHits: number;
  corgiCallsMade: number;
  decodeSuccessCount: number;
  makeModelAgreementChecked: number;
  makeModelAgreementCount: number;
  yearConflictListingCount: number;
}

export function vinPrefix(vin: string): string {
  return vin.slice(0, 11);
}

/**
 * corgi's VehicleInfo types declare make/model/trim/etc as plain `string`,
 * but at runtime a field whose pattern didn't confidently match comes back
 * as an empty string, not undefined (confirmed directly against the
 * Civic-shaped VIN in this project's data — decode succeeded overall,
 * model resolved to ""). `??` doesn't treat "" as missing, so without this
 * helper an unmatched decode field would silently overwrite a perfectly
 * good source-claimed value with emptiness.
 */
function nonEmpty(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function enrichVehicles(
  candidates: Map<string, VehicleCandidate>,
  deps: EnrichDeps
): Promise<{ vehicles: EnrichedVehicle[]; metrics: EnrichMetrics }> {
  const allVins = [...candidates.keys()];
  const uniquePrefixes = [...new Set(allVins.map(vinPrefix))];

  const dbCache = await deps.cacheGet(uniquePrefixes);
  const cache = new Map<string, DecodeResult>(dbCache);
  const toInsert: { prefix: string; decoded: DecodeResult }[] = [];

  let corgiCallsMade = 0;
  for (const prefix of uniquePrefixes) {
    if (cache.has(prefix)) continue;
    // Any VIN with this prefix works — decode is a function of positions 1-11.
    const representativeVin = allVins.find((v) => vinPrefix(v) === prefix)!;
    const decoded = await deps.decode(representativeVin);
    cache.set(prefix, decoded);
    toInsert.push({ prefix, decoded });
    corgiCallsMade++;
  }
  if (toInsert.length > 0) await deps.cacheSet(toInsert);

  const metrics: EnrichMetrics = {
    uniqueVins: allVins.length,
    uniquePrefixes: uniquePrefixes.length,
    cacheHits: dbCache.size,
    corgiCallsMade,
    decodeSuccessCount: 0,
    makeModelAgreementChecked: 0,
    makeModelAgreementCount: 0,
    yearConflictListingCount: 0,
  };

  const vehicles: EnrichedVehicle[] = [];
  for (const [vin, candidate] of candidates) {
    const decodeResult = cache.get(vinPrefix(vin))!;
    const decodedVehicle = decodeResult.valid ? decodeResult.components.vehicle : undefined;
    const decodeSource: "corgi" | "undecoded" = decodedVehicle ? "corgi" : "undecoded";
    if (decodedVehicle) metrics.decodeSuccessCount++;

    const decodedMake = nonEmpty(decodedVehicle?.make);
    const decodedModel = nonEmpty(decodedVehicle?.model);

    let makeModelAgreesWithSource: boolean | null = null;
    if (decodedMake && decodedModel && candidate.survivor.make && candidate.survivor.model) {
      metrics.makeModelAgreementChecked++;
      makeModelAgreesWithSource =
        decodedMake.toLowerCase() === candidate.survivor.make.toLowerCase() &&
        decodedModel.toLowerCase() === candidate.survivor.model.toLowerCase();
      if (makeModelAgreesWithSource) metrics.makeModelAgreementCount++;
    }

    const modelYear = decodedVehicle?.year ?? null;

    const listings: EnrichedListing[] = candidate.listings.map((listing) => {
      const yearConflict = modelYear !== null && listing.rawYear !== modelYear;
      if (yearConflict) metrics.yearConflictListingCount++;
      return { ...listing, yearConflict };
    });

    vehicles.push({
      vin,
      make: decodedMake ?? candidate.survivor.make,
      model: decodedModel ?? candidate.survivor.model,
      modelYear: modelYear ?? candidate.claimedYears[0] ?? null,
      trim: nonEmpty(decodedVehicle?.trim) ?? nonEmpty(decodedVehicle?.series) ?? candidate.survivor.trim,
      bodyStyle: nonEmpty(decodedVehicle?.bodyStyle) ?? candidate.survivor.bodyStyle,
      fuelType: nonEmpty(decodedVehicle?.fuelType) ?? candidate.survivor.fuelType,
      driveTrain: nonEmpty(decodedVehicle?.driveType),
      transmission: nonEmpty(decodedVehicle?.transmission),
      decodeSource,
      makeModelAgreesWithSource,
      listings,
    });
  }

  return { vehicles, metrics };
}
