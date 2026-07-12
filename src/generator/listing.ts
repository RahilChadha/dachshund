import { buildVin, isValidCheckDigit } from "./vin.js";
import { SEED_VEHICLES, type SeedVehicle } from "./seeds.js";
import { corruptCheckDigit, corruptLength, formatPriceDollarComma, formatPriceQuebec, kmToMiles, trimVariant } from "./filth.js";
import type { Rng } from "./rng.js";

const PROVINCES = ["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB"] as const;
const CITY_BY_PROVINCE: Record<string, [string, number, number][]> = {
  ON: [["Toronto", 43.6532, -79.3832], ["Ottawa", 45.4215, -75.6972], ["Hamilton", 43.2557, -79.8711]],
  QC: [["Montreal", 45.5019, -73.5674], ["Quebec City", 46.8139, -71.208]],
  BC: [["Vancouver", 49.2827, -123.1207], ["Kelowna", 49.888, -119.496]],
  AB: [["Calgary", 51.0447, -114.0719], ["Edmonton", 53.5461, -113.4938]],
  MB: [["Winnipeg", 49.8951, -97.1384]],
  SK: [["Regina", 50.4452, -104.6189]],
  NS: [["Halifax", 44.6488, -63.5752]],
  NB: [["Moncton", 46.0878, -64.7782]],
};

export interface CanonicalListing {
  vin: string;
  vinIsStructurallyValid: boolean;
  sellerId: string;
  stockNumber: string;
  price: number;
  odometerKm: number;
  make: string;
  model: string;
  year: number;
  trim: string;
  bodyStyle: string;
  fuelType: string;
  exteriorColor: string;
  interiorColor: string;
  condition: "used" | "new";
  province: string;
  city: string;
  latitude: number;
  longitude: number;
  listedAt: string;
  status: "active" | "removed";
}

const EXTERIOR_COLORS = ["Black", "White", "Grey", "Silver", "Blue", "Red"];
const INTERIOR_COLORS = ["Black", "Grey", "Beige"];

function randomVin(seed: SeedVehicle, year: number, rng: Rng): string {
  const serial = String(rng.int(100000, 999999));
  return buildVin({ wmi: seed.wmi, vds: seed.vds, modelYear: year, plant: seed.plant, serial });
}

/** Builds a clean, internally-consistent listing before any filth is applied. */
export function generateCanonicalListing(rng: Rng, batchSeq: number): CanonicalListing {
  const seed = rng.choice(SEED_VEHICLES);
  const [yearMin, yearMax] = seed.yearRange;
  const year = rng.int(yearMin, yearMax);
  const vin = randomVin(seed, year, rng);
  const province = rng.choice(PROVINCES);
  const cities = CITY_BY_PROVINCE[province]!;
  const [city, latBase, lngBase] = rng.choice(cities);

  const ageYears = Math.max(0, 2026 - year);
  const odometerKm = Math.round(rng.float(8000, 24000) * ageYears + rng.float(0, 5000));
  const depreciation = Math.max(0.35, 1 - ageYears * 0.09);
  const price = Math.round((seed.basePrice * depreciation + rng.float(-1500, 1500)) / 100) * 100;

  return {
    vin,
    vinIsStructurallyValid: true,
    sellerId: `seller-${rng.int(1000, 9999)}`,
    stockNumber: `STK${batchSeq}${rng.int(100, 999)}`,
    price,
    odometerKm,
    make: seed.make,
    model: seed.model,
    year,
    trim: rng.choice(seed.trims),
    bodyStyle: seed.bodyStyle,
    fuelType: seed.fuelType,
    exteriorColor: rng.choice(EXTERIOR_COLORS),
    interiorColor: rng.choice(INTERIOR_COLORS),
    condition: "used",
    province,
    city,
    latitude: Number((latBase + rng.float(-0.05, 0.05)).toFixed(6)),
    longitude: Number((lngBase + rng.float(-0.05, 0.05)).toFixed(6)),
    listedAt: new Date(Date.now() - rng.int(0, 60) * 86_400_000).toISOString(),
    status: rng.bool(0.9) ? "active" : "removed",
  };
}

export interface FilthRates {
  vinBadCheckDigit: number;
  vinWrongLength: number;
  priceMissing: number;
  priceOutlier: number;
  trimVariantSpelling: number;
  fieldMissingGeneric: number;
  odometerSecretMiles: number; // source B only
}

export const DEFAULT_FILTH: FilthRates = {
  vinBadCheckDigit: 0.07,
  vinWrongLength: 0.01,
  priceMissing: 0.03,
  priceOutlier: 0.002,
  trimVariantSpelling: 0.35,
  fieldMissingGeneric: 0.04,
  odometerSecretMiles: 0.12,
};

export function chaosFilth(base: FilthRates): FilthRates {
  return {
    vinBadCheckDigit: Math.min(0.5, base.vinBadCheckDigit * 3),
    vinWrongLength: Math.min(0.3, base.vinWrongLength * 3),
    priceMissing: Math.min(0.5, base.priceMissing * 3),
    priceOutlier: Math.min(0.1, base.priceOutlier * 5),
    trimVariantSpelling: Math.min(0.9, base.trimVariantSpelling * 1.5),
    fieldMissingGeneric: Math.min(0.5, base.fieldMissingGeneric * 3),
    odometerSecretMiles: Math.min(0.5, base.odometerSecretMiles * 2),
  };
}

/** Source A: Dealer Feed A — clean-ish JSON, English fields, CAD, km. */
export function toSourceARecord(listing: CanonicalListing, rng: Rng, filth: FilthRates): Record<string, unknown> {
  let vin = listing.vin;
  if (rng.bool(filth.vinWrongLength)) {
    vin = corruptLength(vin, rng);
  } else if (rng.bool(filth.vinBadCheckDigit)) {
    vin = corruptCheckDigit(vin, rng);
  }

  let price: number | null = listing.price;
  if (rng.bool(filth.priceOutlier)) {
    price = rng.bool(0.5) ? rng.int(999_000, 9_999_999) : rng.int(1, 50);
  } else if (rng.bool(filth.priceMissing)) {
    price = null;
  }

  const trim = rng.bool(filth.trimVariantSpelling) ? trimVariant(listing.trim, rng) : listing.trim;

  const record: Record<string, unknown> = {
    vin,
    sellerId: listing.sellerId,
    stockNumber: listing.stockNumber,
    price,
    currency: "CAD",
    odometer: listing.odometerKm,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    trim,
    bodyStyle: listing.bodyStyle,
    fuelType: listing.fuelType,
    exteriorColor: listing.exteriorColor,
    interiorColor: listing.interiorColor,
    condition: listing.condition,
    province: listing.province,
    city: listing.city,
    latitude: listing.latitude,
    longitude: listing.longitude,
    listedAt: listing.listedAt,
    status: listing.status,
  };

  for (const optionalField of ["trim", "exteriorColor", "interiorColor", "bodyStyle"]) {
    if (rng.bool(filth.fieldMissingGeneric)) delete record[optionalField];
  }

  return record;
}

/** Source B: Marketplace B — CSV, French field names, price as messy strings, sneaky miles. */
export function toSourceBRecord(listing: CanonicalListing, rng: Rng, filth: FilthRates): Record<string, string> {
  let vin = listing.vin;
  if (rng.bool(filth.vinWrongLength)) {
    vin = corruptLength(vin, rng);
  } else if (rng.bool(filth.vinBadCheckDigit)) {
    vin = corruptCheckDigit(vin, rng);
  }

  let prixStr = "";
  if (rng.bool(filth.priceOutlier)) {
    const outlier = rng.bool(0.5) ? rng.int(999_000, 9_999_999) : rng.int(1, 50);
    prixStr = formatPriceDollarComma(outlier);
  } else if (!rng.bool(filth.priceMissing)) {
    prixStr = rng.bool(0.5) ? formatPriceQuebec(listing.price) : formatPriceDollarComma(listing.price);
  }

  const secretlyMiles = rng.bool(filth.odometerSecretMiles);
  const kilometrage = secretlyMiles ? kmToMiles(listing.odometerKm) : listing.odometerKm;

  const version = rng.bool(filth.trimVariantSpelling) ? trimVariant(listing.trim, rng) : listing.trim;

  const record: Record<string, string> = {
    vin,
    vendeur_id: listing.sellerId,
    numero_stock: listing.stockNumber,
    prix: prixStr,
    devise: "CAD",
    kilometrage: String(kilometrage),
    marque: listing.make,
    modele: listing.model,
    annee: String(listing.year),
    version,
    carrosserie: listing.bodyStyle,
    carburant: listing.fuelType,
    couleur_ext: listing.exteriorColor,
    couleur_int: listing.interiorColor,
    etat: listing.condition,
    province: listing.province,
    ville: listing.city,
    latitude: String(listing.latitude),
    longitude: String(listing.longitude),
    date_annonce: listing.listedAt,
    statut: listing.status,
  };

  for (const optionalField of ["version", "couleur_ext", "couleur_int", "carrosserie"]) {
    if (rng.bool(filth.fieldMissingGeneric)) record[optionalField] = "";
  }

  return record;
}

export function isVinStructurallyValid(vin: string): boolean {
  return vin.length === 17 && isValidCheckDigit(vin);
}
