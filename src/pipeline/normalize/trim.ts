import { SEED_VEHICLES } from "../../generator/seeds.js";

/**
 * Canonicalizes a scraped trim string back to one of the known trims for
 * that make/model, undoing the generator's spelling variants (dash removal,
 * spacing, casing, tacked-on "Navi"/"AWD" suffixes). Matching is done on a
 * normalized form (uppercased, punctuation stripped, known suffixes
 * dropped) rather than exact string equality.
 */

const KNOWN_TRIMS_BY_MAKE_MODEL = new Map<string, string[]>();
for (const seed of SEED_VEHICLES) {
  KNOWN_TRIMS_BY_MAKE_MODEL.set(`${seed.make}|${seed.model}`, seed.trims);
}

const TACKED_ON_SUFFIXES = [" NAVI", " AWD"];

function normalize(trim: string): string {
  let t = trim.toUpperCase().trim();
  for (const suffix of TACKED_ON_SUFFIXES) {
    if (t.endsWith(suffix)) t = t.slice(0, -suffix.length);
  }
  return t.replace(/[^A-Z0-9]/g, ""); // strip dashes, spaces, punctuation entirely
}

export interface TrimCanonicalizeResult {
  trim: string | null;
  matched: boolean; // true if we found a known canonical trim for this make/model
}

export function canonicalizeTrim(raw: string | null | undefined, make: string, model: string): TrimCanonicalizeResult {
  if (!raw || raw.trim() === "") {
    return { trim: null, matched: false };
  }

  const knownTrims = KNOWN_TRIMS_BY_MAKE_MODEL.get(`${make}|${model}`);
  if (!knownTrims) {
    return { trim: raw.trim(), matched: false };
  }

  const normalizedRaw = normalize(raw);
  for (const known of knownTrims) {
    if (normalize(known) === normalizedRaw) {
      return { trim: known, matched: true };
    }
  }

  return { trim: raw.trim(), matched: false };
}
