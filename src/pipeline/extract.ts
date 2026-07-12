/**
 * Extract stage: lands locally-generated bronze batches (data/dealer-feed-a,
 * data/marketplace-b) into R2, gzip-compressed, partitioned by source/date:
 *   bronze/source=<source>/date=<YYYY-MM-DD>/batch-NNNN.<ext>.gz
 *
 * Object keys are deterministic (source + date + batch index), so re-running
 * extract for the same date overwrites the same keys instead of duplicating
 * objects — that's what makes this stage idempotent and safe to replay.
 *
 * Usage:
 *   npm run extract                      # land data/ into R2 under today's date partition
 *   npm run extract -- --list            # list existing bronze objects + row counts, don't upload
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, getR2Bucket } from "../r2/client.js";

interface SourceConfig {
  name: string;
  localDir: string;
  ext: "ndjson" | "csv";
}

const SOURCES: SourceConfig[] = [
  { name: "dealer-feed-a", localDir: "data/dealer-feed-a", ext: "ndjson" },
  { name: "marketplace-b", localDir: "data/marketplace-b", ext: "csv" },
];

function todayPartition(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function countRows(filePath: string, ext: string): number {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  return ext === "csv" ? Math.max(0, lines.length - 1) : lines.length;
}

interface BatchRecord {
  key: string;
  rows: number;
  compressedBytes: number;
}

async function landSource(source: SourceConfig, datePartition: string) {
  const client = getR2Client();
  const bucket = getR2Bucket();

  let files: string[];
  try {
    files = readdirSync(source.localDir).filter((f) => f.endsWith(`.${source.ext}`)).sort();
  } catch {
    console.warn(`No local directory ${source.localDir} — run npm run generate first. Skipping ${source.name}.`);
    return { batches: [] as BatchRecord[] };
  }

  const batches: BatchRecord[] = [];
  for (const file of files) {
    const localPath = `${source.localDir}/${file}`;
    const raw = readFileSync(localPath);
    const rows = countRows(localPath, source.ext);

    const key = `bronze/source=${source.name}/date=${datePartition}/${file}.gz`;
    const compressed = gzipSync(raw);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: compressed,
        ContentType: source.ext === "csv" ? "text/csv" : "application/x-ndjson",
        ContentEncoding: "gzip",
      })
    );
    console.log(`  landed ${key} (${rows} rows, ${(compressed.length / 1024).toFixed(0)} KB compressed)`);
    batches.push({ key, rows, compressedBytes: compressed.length });
  }

  // S3/R2's ListObjectsV2 doesn't return custom metadata without a HeadObject
  // per key, which doesn't scale to thousands of objects. Instead we write a
  // manifest per source/date — the cheap, listable source of truth for row
  // counts and idempotency/replay checks.
  const manifest = {
    source: source.name,
    date: datePartition,
    batches,
    totalRows: batches.reduce((sum, b) => sum + b.rows, 0),
    totalObjects: batches.length,
    landedAt: new Date().toISOString(),
  };
  const manifestKey = `bronze/_manifest/source=${source.name}/date=${datePartition}.json`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: "application/json",
    })
  );

  return { batches };
}

async function listBronze() {
  const client = getR2Client();
  const bucket = getR2Bucket();

  for (const source of SOURCES) {
    const resp = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `bronze/_manifest/source=${source.name}/` })
    );
    let totalRows = 0;
    let totalObjects = 0;
    for (const obj of resp.Contents ?? []) {
      const body = await client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key! }));
      const manifest = JSON.parse(await body.Body!.transformToString());
      totalRows += manifest.totalRows;
      totalObjects += manifest.totalObjects;
    }
    console.log(`${source.name}: ${totalObjects} bronze objects across ${resp.Contents?.length ?? 0} date partition(s), ${totalRows} total rows`);
  }
}

async function main() {
  if (process.argv.includes("--list")) {
    await listBronze();
    return;
  }

  if (process.argv.includes("--replay")) {
    // Phase 1 stub: bronze is already the append-only, replayable source of
    // truth (nothing here mutates it). Full "reprocess bronze through
    // validate/normalize/dedupe/load" replay logic lands in Phase 2 once
    // those stages exist — this just confirms what's available to replay.
    console.log("Replay (Phase 2 will add reprocessing here). Current bronze contents:");
    await listBronze();
    return;
  }

  const datePartition = todayPartition();
  console.log(`Landing bronze batches under date=${datePartition}`);

  let grandTotalObjects = 0;
  let grandTotalRows = 0;
  for (const source of SOURCES) {
    console.log(`Landing ${source.name}...`);
    const { batches } = await landSource(source, datePartition);
    const rows = batches.reduce((sum, b) => sum + b.rows, 0);
    grandTotalObjects += batches.length;
    grandTotalRows += rows;
    console.log(`${source.name}: ${batches.length} objects, ${rows} rows landed.`);
  }

  console.log(`\nDone. ${grandTotalObjects} objects, ${grandTotalRows} total rows landed to bronze.`);
}

main().catch((err) => {
  console.error("Extract failed:", err);
  process.exit(1);
});
