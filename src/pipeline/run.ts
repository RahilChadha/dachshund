/**
 * Orchestrates the full transform pipeline for a date partition:
 *   extract (already in bronze) -> validate -> normalize -> dedupe -> enrich -> load -> observe
 *
 * Dedupe/enrich/load operate on the WHOLE run's records at once (not
 * per-batch) because resolving the cross-source VIN overlap requires
 * seeing both sources' records together — deduping per-batch would never
 * join a Source A batch to the Source B batch that happens to share a VIN.
 *
 * Usage: npm run pipeline -- --date 2026-07-12
 */
import { randomUUID, createHash } from "node:crypto";
import { createDecoder } from "@cardog/corgi";
import { getPool } from "../db/client.js";
import { listManifests, readBatch } from "./bronze-reader.js";
import { validateBatch } from "./validate.js";
import { normalizeBatch } from "./normalize/index.js";
import { dedupeByVin } from "./dedupe.js";
import { enrichVehicles } from "./enrich.js";
import { loadEnrichedVehicles } from "./load.js";
import { makeDbBackedCache } from "./decode-cache-db.js";
import { computeDuplicateConflictMetrics, computePriceOutlierRate } from "./metrics.js";
import type { NormalizedRecord, QuarantinedRecord, SourceName } from "./types.js";

const SOURCES: SourceName[] = ["dealer-feed-a", "marketplace-b"];

async function recordPipelineRun(
  pool: ReturnType<typeof getPool>,
  runUuid: string,
  stage: string,
  source: string,
  batchId: string,
  rowsIn: number,
  rowsOut: number,
  rejects: number,
  startedAt: Date,
  finishedAt: Date,
  extraMetrics: Record<string, number> = {}
) {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO pipeline_runs (run_id, stage, source, batch_id, rows_in, rows_out, rejects, started_at, finished_at, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [runUuid, stage, source, batchId, rowsIn, rowsOut, rejects, startedAt, finishedAt, finishedAt.getTime() - startedAt.getTime()]
  );
  const runId = res.rows[0]!.id;
  for (const [name, value] of Object.entries(extraMetrics)) {
    await pool.query(
      `INSERT INTO quality_metrics (run_id, source, metric_name, metric_value) VALUES ($1,$2,$3,$4)`,
      [runId, source, name, value]
    );
  }
}

/**
 * content_hash makes this idempotent: replaying the same bronze batch
 * re-validates the same records and produces the same rejects, so without
 * a dedup key every retry/replay would duplicate the whole quarantine set
 * (this is exactly what happened across several retried runs before this
 * was added — quarantine grew to 3x its real size purely from re-running
 * validate on already-quarantined batches).
 */
function quarantineContentHash(raw: unknown, reasonCodes: string[]): string {
  return createHash("md5").update(JSON.stringify(raw) + "|" + reasonCodes.join(",")).digest("hex");
}

async function insertQuarantineBatch(pool: ReturnType<typeof getPool>, records: QuarantinedRecord[]) {
  const CHUNK = 500;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, idx) => {
      const base = idx * 5;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      params.push(r.source, r.batchId, JSON.stringify(r.raw), r.reasonCodes, quarantineContentHash(r.raw, r.reasonCodes));
    });
    await pool.query(
      `INSERT INTO quarantine (source, batch_id, raw_record, reason_codes, content_hash) VALUES ${values.join(",")}
       ON CONFLICT (source, batch_id, content_hash) DO NOTHING`,
      params
    );
  }
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return { date: get("--date") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const runUuid = randomUUID();
  console.log(`run_id: ${runUuid}`);

  const allNormalized: NormalizedRecord[] = [];
  const perSourceStats = new Map<
    SourceName,
    { rowsIn: number; validated: number; quarantined: number; priceNonNull: number; odometerNonNull: number; trimNonNull: number; trimMatched: number }
  >();
  for (const s of SOURCES) perSourceStats.set(s, { rowsIn: 0, validated: 0, quarantined: 0, priceNonNull: 0, odometerNonNull: 0, trimNonNull: 0, trimMatched: 0 });

  for (const source of SOURCES) {
    const manifests = await listManifests(source);
    const targetManifests = args.date ? manifests.filter((m) => m.date === args.date) : manifests;
    if (targetManifests.length === 0) {
      console.warn(`No bronze manifests found for ${source}${args.date ? ` on ${args.date}` : ""}`);
      continue;
    }

    for (const manifest of targetManifests) {
      for (const batch of manifest.batches) {
        if (batch.rows === 0) continue;
        const startedAt = new Date();
        const raw = await readBatch(source, batch.key);

        const { valid, quarantined } = validateBatch(raw, source, batch.key);
        if (quarantined.length > 0) await insertQuarantineBatch(pool, quarantined);

        const normalized = normalizeBatch(valid);
        allNormalized.push(...normalized);

        const stats = perSourceStats.get(source)!;
        stats.rowsIn += raw.length;
        stats.validated += valid.length;
        stats.quarantined += quarantined.length;
        for (const n of normalized) {
          if (n.priceCents !== null) stats.priceNonNull++;
          if (n.odometerKm !== null) stats.odometerNonNull++;
          if (n.trim !== null) {
            stats.trimNonNull++;
            if (n.trimMatched) stats.trimMatched++;
          }
        }

        const finishedAt = new Date();
        await recordPipelineRun(pool, runUuid, "validate", source, batch.key, raw.length, valid.length, quarantined.length, startedAt, finishedAt, {
          rejection_rate: raw.length > 0 ? quarantined.length / raw.length : 0,
        });
        await recordPipelineRun(pool, runUuid, "normalize", source, batch.key, valid.length, normalized.length, 0, startedAt, finishedAt);

        console.log(`  ${source} ${batch.key}: ${raw.length} in, ${valid.length} valid, ${quarantined.length} quarantined`);
      }
    }
  }

  if (allNormalized.length === 0) {
    console.log("Nothing to process.");
    await pool.end();
    return;
  }

  console.log(`\nDeduping ${allNormalized.length} normalized records...`);
  const dedupeStart = new Date();
  const candidates = dedupeByVin(allNormalized);
  const dedupeMetrics = computeDuplicateConflictMetrics(candidates);
  const dedupeFinish = new Date();
  await recordPipelineRun(pool, runUuid, "dedupe", "all", args.date ?? "all", allNormalized.length, candidates.size, 0, dedupeStart, dedupeFinish, {
    unique_vins: candidates.size,
    vins_within_source_duplicate: dedupeMetrics.vinsWithinSourceDuplicate,
    vins_cross_source_duplicate: dedupeMetrics.vinsCrossSourceDuplicate,
    vins_with_year_conflict: dedupeMetrics.vinsWithYearConflict,
    within_source_duplicate_rate: dedupeMetrics.vinsWithinSourceDuplicate / candidates.size,
    cross_source_duplicate_rate: dedupeMetrics.vinsCrossSourceDuplicate / candidates.size,
    conflict_rate: dedupeMetrics.vinsWithYearConflict / candidates.size,
  });
  console.log(`  ${candidates.size} unique VINs (${dedupeMetrics.vinsCrossSourceDuplicate} cross-source overlaps, ${dedupeMetrics.vinsWithYearConflict} year conflicts)`);

  const { outliers, scored } = computePriceOutlierRate(allNormalized);
  console.log(`  price outliers: ${outliers}/${scored} priced+modeled listings (z-score > 3)`);

  console.log(`\nEnriching via corgi (memoized by WMI+VDS prefix)...`);
  const enrichStart = new Date();
  const decoder = await createDecoder();
  const dbCache = makeDbBackedCache(pool);
  const { vehicles, metrics: enrichMetrics } = await enrichVehicles(candidates, {
    decode: (vin) => decoder.decode(vin),
    ...dbCache,
  });
  await decoder.close();
  const enrichFinish = new Date();
  await recordPipelineRun(pool, runUuid, "enrich", "all", args.date ?? "all", enrichMetrics.uniqueVins, vehicles.length, 0, enrichStart, enrichFinish, {
    unique_prefixes: enrichMetrics.uniquePrefixes,
    cache_hits: enrichMetrics.cacheHits,
    corgi_calls_made: enrichMetrics.corgiCallsMade,
    decode_success_rate: enrichMetrics.decodeSuccessCount / enrichMetrics.uniqueVins,
    make_model_agreement_rate: enrichMetrics.makeModelAgreementChecked > 0 ? enrichMetrics.makeModelAgreementCount / enrichMetrics.makeModelAgreementChecked : 0,
    year_conflict_listings: enrichMetrics.yearConflictListingCount,
  });
  console.log(`  ${enrichMetrics.corgiCallsMade} corgi calls for ${enrichMetrics.uniquePrefixes} unique prefixes (${enrichMetrics.uniqueVins} unique VINs) — decode success ${(100 * enrichMetrics.decodeSuccessCount / enrichMetrics.uniqueVins).toFixed(1)}%`);

  console.log(`\nLoading into Neon...`);
  const loadStart = new Date();
  const client = await pool.connect();
  let loadMetrics;
  try {
    loadMetrics = await loadEnrichedVehicles(client, vehicles);
  } finally {
    client.release();
  }
  const loadFinish = new Date();
  await recordPipelineRun(pool, runUuid, "load", "all", args.date ?? "all", vehicles.length, loadMetrics.vehiclesUpserted, 0, loadStart, loadFinish, {
    vehicles_upserted: loadMetrics.vehiclesUpserted,
    listings_upserted: loadMetrics.listingsUpserted,
    price_history_rows_written: loadMetrics.priceHistoryRowsWritten,
  });
  console.log(`  ${loadMetrics.vehiclesUpserted} vehicles, ${loadMetrics.listingsUpserted} listings, ${loadMetrics.priceHistoryRowsWritten} price_history rows`);

  for (const [source, stats] of perSourceStats) {
    if (stats.rowsIn === 0) continue;
    await recordPipelineRun(pool, runUuid, "summary", source, args.date ?? "all", stats.rowsIn, stats.validated, stats.quarantined, dedupeStart, loadFinish, {
      field_completeness_price_pct: stats.rowsIn > 0 ? stats.priceNonNull / stats.rowsIn : 0,
      field_completeness_odometer_pct: stats.rowsIn > 0 ? stats.odometerNonNull / stats.rowsIn : 0,
      trim_normalization_coverage: stats.trimNonNull > 0 ? stats.trimMatched / stats.trimNonNull : 0,
    });
  }

  console.log(`\nDone.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Pipeline run failed:", err);
  process.exit(1);
});
