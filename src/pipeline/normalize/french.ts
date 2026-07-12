/**
 * Maps Source B's French CSV field names to the canonical English field
 * names used everywhere downstream (matching Source A's shape, which in
 * turn matches the field names observed in the real Cardog API response).
 */
export const FRENCH_TO_CANONICAL: Record<string, string> = {
  vin: "vin",
  vendeur_id: "sellerId",
  numero_stock: "stockNumber",
  prix: "price",
  devise: "currency",
  kilometrage: "odometer",
  marque: "make",
  modele: "model",
  annee: "year",
  version: "trim",
  carrosserie: "bodyStyle",
  carburant: "fuelType",
  couleur_ext: "exteriorColor",
  couleur_int: "interiorColor",
  etat: "condition",
  province: "province",
  ville: "city",
  latitude: "latitude",
  longitude: "longitude",
  date_annonce: "listedAt",
  statut: "status",
};

export function mapFrenchRecord(record: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [frenchKey, value] of Object.entries(record)) {
    const canonicalKey = FRENCH_TO_CANONICAL[frenchKey];
    if (canonicalKey) {
      mapped[canonicalKey] = value;
    }
  }
  return mapped;
}
