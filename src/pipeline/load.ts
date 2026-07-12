import { from as copyFrom } from "pg-copy-streams";
import type { PoolClient } from "pg";
import type { EnrichedVehicle } from "./enrich.js";

/**
 * CSV-escapes a single field for COPY ... WITH (FORMAT csv). An unquoted
 * empty field means SQL NULL in Postgres's CSV format; a real empty string
 * must be explicitly quoted ("") so it isn't misread as NULL.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str === "") return '""';
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function copyRows(client: PoolClient, copySql: string, rows: unknown[][]): Promise<void> {
  const stream = client.query(copyFrom(copySql));
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", resolve);
    for (const row of rows) {
      stream.write(row.map(csvField).join(",") + "\n");
    }
    stream.end();
  });
}

export interface LoadMetrics {
  vehiclesUpserted: number;
  listingsUpserted: number;
  priceHistoryRowsWritten: number;
}

const VEHICLE_STAGING_COLUMNS = [
  "vin", "wmi", "make", "model", "model_year", "trim", "body_style", "fuel_type",
  "drive_train", "transmission", "decode_source",
];

const LISTING_STAGING_COLUMNS = [
  "vin", "source", "source_listing_id", "batch_id", "price_cents", "currency",
  "odometer_km", "trim_raw", "province", "city", "latitude", "longitude",
  "status", "year_conflict", "listed_at", "raw_payload", "make", "model", "model_year",
];

export async function loadEnrichedVehicles(client: PoolClient, vehicles: EnrichedVehicle[]): Promise<LoadMetrics> {
  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TEMP TABLE staging_vehicles (
        vin CHAR(17), wmi CHAR(3), make TEXT, model TEXT, model_year SMALLINT,
        trim TEXT, body_style TEXT, fuel_type TEXT, drive_train TEXT,
        transmission TEXT, decode_source TEXT
      ) ON COMMIT DROP
    `);
    await client.query(`
      CREATE TEMP TABLE staging_listings (
        vin CHAR(17), source TEXT, source_listing_id TEXT, batch_id TEXT,
        price_cents BIGINT, currency TEXT, odometer_km INTEGER, trim_raw TEXT,
        province TEXT, city TEXT, latitude NUMERIC(9,6), longitude NUMERIC(9,6),
        status TEXT, year_conflict BOOLEAN, listed_at TIMESTAMPTZ, raw_payload JSONB,
        make TEXT, model TEXT, model_year SMALLINT
      ) ON COMMIT DROP
    `);

    const vehicleRows = vehicles.map((v) => [
      v.vin, v.vin.slice(0, 3), v.make, v.model, v.modelYear, v.trim, v.bodyStyle,
      v.fuelType, v.driveTrain, v.transmission, v.decodeSource,
    ]);
    await copyRows(
      client,
      `COPY staging_vehicles (${VEHICLE_STAGING_COLUMNS.join(",")}) FROM STDIN WITH (FORMAT csv)`,
      vehicleRows
    );

    // Dedupe by (source, source_listing_id) before COPY: Postgres's ON CONFLICT
    // DO UPDATE cannot affect the same target row twice within one command, so
    // any two rows colliding on the natural key within a single load batch
    // would abort the whole transaction. Last-write-wins within the batch,
    // mirroring "freshest wins" semantics used elsewhere in this stage.
    const listingsByKey = new Map<string, unknown[]>();
    let duplicateKeysInBatch = 0;
    for (const v of vehicles) {
      for (const listing of v.listings) {
        const sourceListingId = listing.stockNumber ?? `${listing.source}-${v.vin}`;
        const key = `${listing.source} ${sourceListingId}`;
        if (listingsByKey.has(key)) duplicateKeysInBatch++;
        listingsByKey.set(key, [
          v.vin, listing.source, sourceListingId, listing.batchId,
          listing.priceCents, "CAD", listing.odometerKm, listing.trim, listing.province, listing.city,
          listing.latitude, listing.longitude, listing.status ?? "active", listing.yearConflict,
          listing.listedAt, listing.raw,
          // Denormalized from the enriched (decode-trusted) vehicle, not the
          // raw source claim, so gold queries filtering by make/model/year
          // reflect corgi's decode rather than a dealer's possibly-wrong entry.
          v.make, v.model, v.modelYear,
        ]);
      }
    }
    if (duplicateKeysInBatch > 0) {
      console.warn(`  load: ${duplicateKeysInBatch} listing rows shared a (source, source_listing_id) key within this batch — kept the last one each.`);
    }
    await copyRows(
      client,
      `COPY staging_listings (${LISTING_STAGING_COLUMNS.join(",")}) FROM STDIN WITH (FORMAT csv)`,
      [...listingsByKey.values()]
    );

    const vehicleUpsert = await client.query(`
      INSERT INTO vehicles (vin, wmi, make, model, model_year, trim, body_style, fuel_type, drive_train, transmission, decode_source, first_seen_at, last_seen_at)
      SELECT vin, wmi, make, model, model_year, trim, body_style, fuel_type, drive_train, transmission, decode_source, now(), now()
      FROM staging_vehicles
      ON CONFLICT (vin) DO UPDATE SET
        make = COALESCE(EXCLUDED.make, vehicles.make),
        model = COALESCE(EXCLUDED.model, vehicles.model),
        model_year = COALESCE(EXCLUDED.model_year, vehicles.model_year),
        trim = COALESCE(EXCLUDED.trim, vehicles.trim),
        body_style = COALESCE(EXCLUDED.body_style, vehicles.body_style),
        fuel_type = COALESCE(EXCLUDED.fuel_type, vehicles.fuel_type),
        drive_train = COALESCE(EXCLUDED.drive_train, vehicles.drive_train),
        transmission = COALESCE(EXCLUDED.transmission, vehicles.transmission),
        decode_source = CASE WHEN EXCLUDED.decode_source = 'corgi' THEN 'corgi' ELSE vehicles.decode_source END,
        last_seen_at = now(),
        updated_at = now()
    `);

    const listingUpsert = await client.query(`
      INSERT INTO listings (vin, source, source_listing_id, batch_id, price_cents, currency, odometer_km, trim_raw, province, city, latitude, longitude, status, year_conflict, listed_at, raw_payload, make, model, model_year)
      SELECT vin, source, source_listing_id, batch_id, price_cents, currency, odometer_km, trim_raw, province, city, latitude, longitude, status, year_conflict, listed_at, raw_payload, make, model, model_year
      FROM staging_listings
      ON CONFLICT (source, source_listing_id) DO UPDATE SET
        batch_id = EXCLUDED.batch_id,
        price_cents = EXCLUDED.price_cents,
        odometer_km = COALESCE(EXCLUDED.odometer_km, listings.odometer_km),
        trim_raw = COALESCE(EXCLUDED.trim_raw, listings.trim_raw),
        province = COALESCE(EXCLUDED.province, listings.province),
        city = COALESCE(EXCLUDED.city, listings.city),
        latitude = COALESCE(EXCLUDED.latitude, listings.latitude),
        longitude = COALESCE(EXCLUDED.longitude, listings.longitude),
        status = EXCLUDED.status,
        year_conflict = EXCLUDED.year_conflict,
        delisted_at = CASE WHEN EXCLUDED.status = 'removed' AND listings.status <> 'removed' THEN now() ELSE listings.delisted_at END,
        raw_payload = EXCLUDED.raw_payload,
        make = COALESCE(EXCLUDED.make, listings.make),
        model = COALESCE(EXCLUDED.model, listings.model),
        model_year = COALESCE(EXCLUDED.model_year, listings.model_year),
        updated_at = now()
    `);

    // Price history: one row per listing whose price differs from its most
    // recent recorded price (or has none yet) — idempotent by construction,
    // since replaying identical data means "latest price" already matches.
    const priceHistoryInsert = await client.query(`
      WITH latest_price AS (
        SELECT DISTINCT ON (listing_id) listing_id, price_cents
        FROM price_history
        ORDER BY listing_id, observed_at DESC
      )
      INSERT INTO price_history (vin, listing_id, price_cents, observed_at)
      SELECT s.vin, l.id, s.price_cents, now()
      FROM staging_listings s
      JOIN listings l ON l.source = s.source AND l.source_listing_id = s.source_listing_id
      LEFT JOIN latest_price lp ON lp.listing_id = l.id
      WHERE s.price_cents IS NOT NULL AND lp.price_cents IS DISTINCT FROM s.price_cents
    `);

    await client.query("COMMIT");

    return {
      vehiclesUpserted: vehicleUpsert.rowCount ?? 0,
      listingsUpserted: listingUpsert.rowCount ?? 0,
      priceHistoryRowsWritten: priceHistoryInsert.rowCount ?? 0,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
