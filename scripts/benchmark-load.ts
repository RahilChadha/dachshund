/**
 * Benchmarks COPY-based bulk load vs naive row-by-row INSERT, using a
 * throwaway table this script creates and drops itself — never touches
 * real pipeline data. Numbers get written to BENCHMARKS.md by hand from
 * this script's output (kept manual rather than auto-appended, so the
 * markdown table stays curated instead of accumulating every run).
 *
 * Usage: npm run benchmark:load -- --n 50000
 */
import { from as copyFrom } from "pg-copy-streams";
import { getPool } from "../src/db/client.js";
import { createRng } from "../src/generator/rng.js";
import { generateCanonicalListing } from "../src/generator/listing.js";

function parseArgs(argv: string[]) {
  const i = argv.indexOf("--n");
  return { n: i === -1 ? 50000 : Number(argv[i + 1]) };
}

async function main() {
  const { n } = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const rng = createRng(1234);
  const rows = Array.from({ length: n }, (_, i) => generateCanonicalListing(rng, i));

  console.log(`Benchmarking COPY vs row-insert for ${n} rows...`);

  await pool.query(`DROP TABLE IF EXISTS benchmark_copy`);
  await pool.query(`DROP TABLE IF EXISTS benchmark_rowinsert`);
  const ddl = `(vin CHAR(17), make TEXT, model TEXT, model_year SMALLINT, price_cents BIGINT, odometer_km INTEGER)`;
  await pool.query(`CREATE TABLE benchmark_copy ${ddl}`);
  await pool.query(`CREATE TABLE benchmark_rowinsert ${ddl}`);

  // --- COPY ---
  const copyClient = await pool.connect();
  const copyStart = performance.now();
  try {
    const stream = copyClient.query(copyFrom(`COPY benchmark_copy (vin, make, model, model_year, price_cents, odometer_km) FROM STDIN WITH (FORMAT csv)`));
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", resolve);
      for (const r of rows) {
        stream.write(`${r.vin},${r.make},${r.model},${r.year},${r.price},${r.odometerKm}\n`);
      }
      stream.end();
    });
  } finally {
    copyClient.release();
  }
  const copyMs = performance.now() - copyStart;

  // --- naive row-by-row INSERT (one round trip per row, as a default ORM loop would) ---
  const insertClient = await pool.connect();
  const insertStart = performance.now();
  try {
    for (const r of rows) {
      await insertClient.query(
        `INSERT INTO benchmark_rowinsert (vin, make, model, model_year, price_cents, odometer_km) VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.vin, r.make, r.model, r.year, r.price, r.odometerKm]
      );
    }
  } finally {
    insertClient.release();
  }
  const insertMs = performance.now() - insertStart;

  console.log(`\nCOPY:        ${copyMs.toFixed(0)} ms  (${(n / (copyMs / 1000)).toFixed(0)} rows/sec)`);
  console.log(`Row INSERT:  ${insertMs.toFixed(0)} ms  (${(n / (insertMs / 1000)).toFixed(0)} rows/sec)`);
  console.log(`Speedup:     ${(insertMs / copyMs).toFixed(1)}x`);

  await pool.query(`DROP TABLE benchmark_copy`);
  await pool.query(`DROP TABLE benchmark_rowinsert`);
  await pool.end();
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
