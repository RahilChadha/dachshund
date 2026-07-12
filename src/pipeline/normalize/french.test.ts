import { describe, it, expect } from "vitest";
import { mapFrenchRecord, FRENCH_TO_CANONICAL } from "./french.js";

describe("mapFrenchRecord", () => {
  it("maps every field the generator's CSV writer produces", () => {
    // CSV_COLUMNS in src/generator/index.ts — kept in sync deliberately.
    const csvColumns = [
      "vin", "vendeur_id", "numero_stock", "prix", "devise", "kilometrage",
      "marque", "modele", "annee", "version", "carrosserie", "carburant",
      "couleur_ext", "couleur_int", "etat", "province", "ville", "latitude",
      "longitude", "date_annonce", "statut",
    ];
    for (const col of csvColumns) {
      expect(FRENCH_TO_CANONICAL[col], `missing mapping for ${col}`).toBeDefined();
    }
  });

  it("maps a full record correctly", () => {
    const result = mapFrenchRecord({
      vin: "1VWBH7A30DC104945",
      prix: "$34,999",
      kilometrage: "76559",
      marque: "Volkswagen",
      modele: "Passat",
      annee: "2013",
      version: "Comfortline",
    });
    expect(result).toEqual({
      vin: "1VWBH7A30DC104945",
      price: "$34,999",
      odometer: "76559",
      make: "Volkswagen",
      model: "Passat",
      year: "2013",
      trim: "Comfortline",
    });
  });

  it("drops unrecognized fields rather than throwing", () => {
    const result = mapFrenchRecord({ champ_inconnu: "x", vin: "abc" });
    expect(result).toEqual({ vin: "abc" });
  });
});
