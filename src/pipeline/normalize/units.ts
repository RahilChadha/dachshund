/**
 * Odometer unit unification. Source A is always km. Source B sometimes
 * reports miles with no unit label at all (the "secretly in miles" filth) —
 * there's no field to check, so this is a heuristic: an implausibly low
 * annual-distance rate for a used car in Canada (Canadians drive ~15-20k
 * km/year on average) is a signal the number is actually miles.
 *
 * This is a deliberate judgment call, not a guarantee, and it is
 * intentionally imperfect. A field secretly holding miles reads as ~0.62x
 * the true km figure, so mislabeled records skew toward a LOWER apparent
 * annual rate — but they don't all fall below any single clean threshold.
 * At 11,000 apparent-km/year (below the ~15-20k/year Canadians actually
 * average), this catches roughly the vehicles whose true annual rate was
 * under ~17,700 km/year and misses higher-mileage secretly-miles cars
 * whose apparent rate still looks normal. That gap — and the mirror-image
 * false positive on a genuinely low-mileage newer car — is a real
 * limitation, not a bug, and is called out in the quality metrics rather
 * than hidden.
 */
export interface OdometerNormalizeResult {
  odometerKm: number | null;
  wasConvertedFromMiles: boolean;
}

const MILES_TO_KM = 1.60934;
const IMPLAUSIBLE_ANNUAL_KM_THRESHOLD = 11000;

export function normalizeOdometer(
  raw: unknown,
  vehicleYear: number,
  referenceYear: number,
  options: { assumeSourceBMayBeMiles: boolean }
): OdometerNormalizeResult {
  if (raw === null || raw === undefined || raw === "") {
    return { odometerKm: null, wasConvertedFromMiles: false };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { odometerKm: null, wasConvertedFromMiles: false };
  }

  if (!options.assumeSourceBMayBeMiles) {
    return { odometerKm: Math.round(value), wasConvertedFromMiles: false };
  }

  const ageYears = Math.max(1, referenceYear - vehicleYear);
  const annualRate = value / ageYears;

  if (annualRate < IMPLAUSIBLE_ANNUAL_KM_THRESHOLD) {
    return { odometerKm: Math.round(value * MILES_TO_KM), wasConvertedFromMiles: true };
  }

  return { odometerKm: Math.round(value), wasConvertedFromMiles: false };
}
