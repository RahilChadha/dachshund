/**
 * Parses price fields from either source into integer cents. Handles:
 *  - a plain number (Source A, most of the time)
 *  - "$34,999" (Source B dollar-comma format)
 *  - "35 995 $" (Source B Quebec format — space thousands separator, trailing $)
 *  - missing/empty (returns null, never throws — a missing price is a
 *    completeness problem the quality metrics track, not a rejection reason)
 */
export interface PriceParseResult {
  priceCents: number | null;
  wasMalformed: boolean; // true if a non-empty value had to be string-parsed
}

export function parsePrice(raw: unknown): PriceParseResult {
  if (raw === null || raw === undefined) {
    return { priceCents: null, wasMalformed: false };
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { priceCents: null, wasMalformed: false };
    return { priceCents: Math.round(raw * 100), wasMalformed: false };
  }

  const str = String(raw).trim();
  if (str === "") {
    return { priceCents: null, wasMalformed: false };
  }

  // Strip currency symbol, thousands separators (comma or space), keep digits and decimal point.
  const cleaned = str
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return { priceCents: null, wasMalformed: true };
  }

  return { priceCents: Math.round(value * 100), wasMalformed: true };
}
