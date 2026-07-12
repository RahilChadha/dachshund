import { isValidCheckDigit } from "../generator/vin.js";
import type { RawCanonicalRecord, ValidatedRecord, QuarantinedRecord, SourceName } from "./types.js";

/**
 * Structural validation only (VIN shape/check-digit, year sanity) — never
 * silently drops a record, everything that fails gets a reason code and
 * goes to quarantine. Deliberately does NOT use @cardog/corgi.decode() here:
 * decode() does full NHTSA pattern matching against the bundled SQLite
 * database on every call, which doesn't scale cheaply to a million rows.
 * Our own check-digit algorithm (src/generator/vin.ts) computes the exact
 * same ISO 3779 result — verified against corgi's own output for the real
 * reference VIN — so it's used here for O(1)-per-record validation. Corgi
 * is reserved for the enrich stage, which runs once per *unique* VIN after
 * dedup, not once per raw record.
 */

const CURRENT_YEAR = new Date().getFullYear();
const MIN_MODEL_YEAR = 1980;

export interface ValidationResult {
  valid: ValidatedRecord[];
  quarantined: QuarantinedRecord[];
}

export function validateBatch(records: RawCanonicalRecord[], source: SourceName, batchId: string): ValidationResult {
  const valid: ValidatedRecord[] = [];
  const quarantined: QuarantinedRecord[] = [];

  for (const raw of records) {
    const reasonCodes: string[] = [];

    const vin = typeof raw.vin === "string" ? raw.vin.trim() : "";
    if (vin === "") {
      reasonCodes.push("vin_missing");
    } else if (vin.length !== 17) {
      reasonCodes.push("vin_wrong_length");
    } else if (!isValidCheckDigit(vin)) {
      reasonCodes.push("vin_bad_check_digit");
    }

    const yearNum = Number(raw.year);
    const yearValid = Number.isFinite(yearNum) && yearNum >= MIN_MODEL_YEAR && yearNum <= CURRENT_YEAR + 1;
    if (raw.year === undefined || raw.year === null || raw.year === "") {
      reasonCodes.push("year_missing");
    } else if (!yearValid) {
      reasonCodes.push("year_out_of_range");
    }

    if (reasonCodes.length > 0) {
      quarantined.push({ source, batchId, raw, reasonCodes });
      continue;
    }

    valid.push({
      source,
      batchId,
      vin: vin.toUpperCase(),
      sellerId: typeof raw.sellerId === "string" ? raw.sellerId : null,
      stockNumber: typeof raw.stockNumber === "string" ? raw.stockNumber : null,
      rawYear: yearNum,
      raw,
    });
  }

  return { valid, quarantined };
}
