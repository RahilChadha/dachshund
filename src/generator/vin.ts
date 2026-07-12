/**
 * VIN construction and check-digit validation per ISO 3779 / NHTSA (used
 * across North America, including Canada). Reference VIN used to validate
 * this implementation: "1VWBH7A30DC104945" (a real 2013 VW Passat pulled
 * from the Cardog API in reference/real-listings.json) — position 10 'D'
 * decodes to 2013 and the check digit at position 9 ('0') is correct under
 * this algorithm, which is exercised in vin.test.ts.
 */

// I, O, Q are deliberately excluded — VINs never contain them, to avoid
// confusion with 1 and 0.
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
};

// Position weights 1-17 (position 9, the check digit itself, has weight 0
// and is excluded from its own calculation).
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// 30-year repeating cycle, positions 1980-2009 and 2010-2039 share codes.
const MODEL_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

export function modelYearToCode(year: number): string {
  const idx = (year - 1980) % 30;
  if (idx < 0) throw new Error(`Year ${year} predates VIN model-year encoding`);
  return MODEL_YEAR_CODES[idx]!;
}

export function computeCheckDigit(vin: string): string {
  if (vin.length !== 17) throw new Error(`computeCheckDigit requires a 17-char VIN, got ${vin.length}`);
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!.toUpperCase();
    const value = TRANSLITERATION[ch];
    if (value === undefined) throw new Error(`Invalid VIN character '${ch}' at position ${i + 1}`);
    sum += value * WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

export function isValidCheckDigit(vin: string): boolean {
  if (vin.length !== 17) return false;
  try {
    return computeCheckDigit(vin) === vin[8]!.toUpperCase();
  } catch {
    return false;
  }
}

export interface VinParts {
  wmi: string; // 3 chars, positions 1-3
  vds: string; // 5 chars, positions 4-8 (descriptor: body/engine/restraint etc, manufacturer-specific)
  modelYear: number; // encodes position 10
  plant: string; // 1 char, position 11
  serial: string; // 6 digits, positions 12-17
}

/** Builds a structurally valid VIN with a correct check digit at position 9. */
export function buildVin(parts: VinParts): string {
  if (parts.wmi.length !== 3) throw new Error("wmi must be 3 chars");
  if (parts.vds.length !== 5) throw new Error("vds must be 5 chars");
  if (parts.plant.length !== 1) throw new Error("plant must be 1 char");
  if (parts.serial.length !== 6) throw new Error("serial must be 6 chars");

  const yearCode = modelYearToCode(parts.modelYear);
  // Placeholder '0' at position 9 while computing the real check digit.
  const withoutCheckDigit =
    parts.wmi + parts.vds + "0" + yearCode + parts.plant + parts.serial;
  const checkDigit = computeCheckDigit(withoutCheckDigit);
  return parts.wmi + parts.vds + checkDigit + yearCode + parts.plant + parts.serial;
}
