/**
 * Generates source A (Dealer Feed A, NDJSON) and source B (Marketplace B,
 * CSV) listings. Streams to local files under data/ (gitignored — bronze's
 * real home is R2, this is just the generator's scratch output that
 * src/pipeline/extract.ts reads and lands).
 *
 * Usage: npm run generate -- --seed 42 --countA 650000 --countB 350000 [--chaos]
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { createRng } from "./rng.js";
import { generateCanonicalListing, toSourceARecord, toSourceBRecord, DEFAULT_FILTH, chaosFilth, type CanonicalListing } from "./listing.js";

interface Args {
  seed: number;
  countA: number;
  countB: number;
  chaos: boolean;
  outDir: string;
  overlapRate: number; // fraction of B's records that reuse an A VIN with contradictory data
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1]!;
  };
  return {
    seed: Number(get("--seed", "42")),
    countA: Number(get("--countA", "650000")),
    countB: Number(get("--countB", "350000")),
    chaos: argv.includes("--chaos"),
    outDir: get("--outDir", "data"),
    overlapRate: Number(get("--overlapRate", "0.02")),
  };
}

const CSV_COLUMNS = [
  "vin", "vendeur_id", "numero_stock", "prix", "devise", "kilometrage",
  "marque", "modele", "annee", "version", "carrosserie", "carburant",
  "couleur_ext", "couleur_int", "etat", "province", "ville", "latitude",
  "longitude", "date_annonce", "statut",
];

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(record: Record<string, string>): string {
  return CSV_COLUMNS.map((col) => csvEscape(record[col] ?? "")).join(",") + "\n";
}

const BATCH_SIZE = 50_000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filth = args.chaos ? chaosFilth(DEFAULT_FILTH) : DEFAULT_FILTH;
  const rng = createRng(args.seed);

  const dirA = `${args.outDir}/dealer-feed-a`;
  const dirB = `${args.outDir}/marketplace-b`;
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });

  console.log(`Generating ${args.countA} source-A + ${args.countB} source-B listings (seed=${args.seed}, chaos=${args.chaos})`);

  // Reservoir of A's canonical listings kept around so B can deliberately
  // reuse ~overlapRate of them with contradictory year/price — this is what
  // creates the cross-source dedup problem the pipeline needs to resolve.
  const overlapPoolSize = Math.ceil(args.countB * args.overlapRate * 1.2);
  const overlapPool: CanonicalListing[] = [];

  let batchIdxA = 0;
  let streamA = openBatch(dirA, "ndjson", batchIdxA);
  let writtenInBatchA = 0;

  for (let i = 0; i < args.countA; i++) {
    const listing = generateCanonicalListing(rng, i);
    if (overlapPool.length < overlapPoolSize) {
      overlapPool.push(listing);
    } else if (rng.bool(0.05)) {
      overlapPool[rng.int(0, overlapPool.length - 1)] = listing;
    }

    const record = toSourceARecord(listing, rng, filth);
    streamA.write(JSON.stringify(record) + "\n");
    writtenInBatchA++;

    if (writtenInBatchA >= BATCH_SIZE && i + 1 < args.countA) {
      await closeStream(streamA);
      batchIdxA++;
      streamA = openBatch(dirA, "ndjson", batchIdxA);
      writtenInBatchA = 0;
    }
  }
  await closeStream(streamA);

  let batchIdxB = 0;
  let streamB = openBatch(dirB, "csv", batchIdxB);
  streamB.write(CSV_COLUMNS.join(",") + "\n");
  let writtenInBatchB = 0;

  for (let i = 0; i < args.countB; i++) {
    let listing: CanonicalListing;
    if (overlapPool.length > 0 && rng.bool(args.overlapRate)) {
      const base = rng.choice(overlapPool);
      // Contradictory: different year (+/-1) and a materially different price,
      // same VIN — exactly the conflict the dedupe/survivorship stage must resolve.
      listing = {
        ...base,
        year: base.year + (rng.bool(0.5) ? 1 : -1),
        price: Math.round((base.price * rng.float(0.85, 1.15)) / 100) * 100,
      };
    } else {
      listing = generateCanonicalListing(rng, args.countA + i);
    }

    const record = toSourceBRecord(listing, rng, filth);
    streamB.write(csvRow(record));
    writtenInBatchB++;

    if (writtenInBatchB >= BATCH_SIZE && i + 1 < args.countB) {
      await closeStream(streamB);
      batchIdxB++;
      streamB = openBatch(dirB, "csv", batchIdxB);
      streamB.write(CSV_COLUMNS.join(",") + "\n");
      writtenInBatchB = 0;
    }
  }
  await closeStream(streamB);

  console.log(`Done. Wrote ${batchIdxA + 1} NDJSON batches to ${dirA}, ${batchIdxB + 1} CSV batches to ${dirB}.`);
}

function openBatch(dir: string, ext: string, idx: number) {
  const path = `${dir}/batch-${String(idx).padStart(4, "0")}.${ext}`;
  return createWriteStream(path);
}

function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err: unknown) => (err ? reject(err) : resolve()));
  });
}

main().catch((err) => {
  console.error("Generator failed:", err);
  process.exit(1);
});
