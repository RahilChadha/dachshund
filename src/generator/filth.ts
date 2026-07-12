import type { Rng } from "./rng.js";

/** "$34,999" style formatting. */
export function formatPriceDollarComma(price: number): string {
  return `$${Math.round(price).toLocaleString("en-US")}`;
}

/** "35 995 $" Quebec-style formatting (space thousands separator, trailing $). */
export function formatPriceQuebec(price: number): string {
  const rounded = Math.round(price);
  const withSpaces = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${withSpaces} $`;
}

/** Produces plausible alternate spellings of a trim string, e.g. "EX-L" -> "EXL" / "EX L". */
export function trimVariant(trim: string, rng: Rng): string {
  const variants: Array<(t: string) => string> = [
    (t) => t.replace(/-/g, ""), // "EX-L" -> "EXL"
    (t) => t.replace(/-/g, " "), // "EX-L" -> "EX L"
    (t) => t.toUpperCase(),
    (t) => t.toLowerCase(),
    (t) => `${t} Navi`, // trailing option tacked on, as dealers often do
    (t) => `${t} AWD`,
  ];
  return rng.choice(variants)(trim);
}

/** Flips the check digit (VIN position 9) to an incorrect-but-plausible value. */
export function corruptCheckDigit(vin: string, rng: Rng): string {
  const digits = "0123456789X";
  let corrupted: string;
  do {
    corrupted = rng.choice(digits.split(""));
  } while (corrupted === vin[8]);
  return vin.slice(0, 8) + corrupted + vin.slice(9);
}

/** Truncates or pads a VIN so it fails the 17-char structural check. */
export function corruptLength(vin: string, rng: Rng): string {
  return rng.bool(0.5) ? vin.slice(0, 16) : vin + rng.choice("0123456789".split(""));
}

/** Converts a km figure to the equivalent whole-number mile reading. */
export function kmToMiles(km: number): number {
  return Math.round(km * 0.621371);
}
