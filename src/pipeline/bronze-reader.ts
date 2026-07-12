import { gunzipSync } from "node:zlib";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { parse as parseCsv } from "csv-parse/sync";
import { getR2Client, getR2Bucket } from "../r2/client.js";
import { mapFrenchRecord } from "./normalize/french.js";
import type { RawCanonicalRecord, SourceName } from "./types.js";

export interface BronzeManifest {
  source: SourceName;
  date: string;
  batches: { key: string; rows: number; compressedBytes: number }[];
  totalRows: number;
  totalObjects: number;
  landedAt: string;
}

export async function listManifests(source: SourceName): Promise<BronzeManifest[]> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  const resp = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: `bronze/_manifest/source=${source}/` })
  );
  const manifests: BronzeManifest[] = [];
  for (const obj of resp.Contents ?? []) {
    const body = await client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key! }));
    manifests.push(JSON.parse(await body.Body!.transformToString()));
  }
  return manifests.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchAndDecompress(key: string): Promise<Buffer> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const compressed = Buffer.from(await resp.Body!.transformToByteArray());
  return gunzipSync(compressed);
}

/** Reads one bronze batch object and returns canonical-shaped raw records (French-mapped for Source B). */
export async function readBatch(source: SourceName, batchKey: string): Promise<RawCanonicalRecord[]> {
  const raw = await fetchAndDecompress(batchKey);

  if (source === "dealer-feed-a") {
    return raw
      .toString("utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RawCanonicalRecord);
  }

  // marketplace-b: CSV with French headers -> map to canonical field names
  const rows: Record<string, string>[] = parseCsv(raw, { columns: true, skip_empty_lines: true });
  return rows.map((row) => mapFrenchRecord(row) as RawCanonicalRecord);
}
