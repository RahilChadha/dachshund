/**
 * Runs 5 realistic queries with EXPLAIN ANALYZE. Run once before
 * `npm run db:apply-phase3` and once after, and hand-curate the timings
 * into BENCHMARKS.md — kept manual so the table stays a clean before/after
 * comparison instead of an ever-growing log.
 *
 * Usage: npm run benchmark:queries -- --label before
 */
import { getPool } from "../src/db/client.js";

const QUERIES: { name: string; sql: string; params: unknown[] }[] = [
  {
    name: "1. Browse: active Honda Civic 2018-2022 listings in Ontario",
    sql: `SELECT id, vin, price_cents, odometer_km, city FROM listings
          WHERE make = $1 AND model = $2 AND model_year BETWEEN $3 AND $4
            AND province = $5 AND status = 'active'
          ORDER BY price_cents ASC LIMIT 50`,
    params: ["Honda", "Civic", 2018, 2022, "ON"],
  },
  {
    name: "2. Market stats: avg/median price by make/model/year/province",
    sql: `SELECT make, model, model_year, province,
                 count(*) AS n, avg(price_cents)::bigint AS avg_price_cents,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY price_cents)::bigint AS median_price_cents
          FROM listings
          WHERE status = 'active' AND price_cents IS NOT NULL AND make = $1
          GROUP BY make, model, model_year, province
          ORDER BY n DESC LIMIT 20`,
    params: ["Toyota"],
  },
  {
    name: "3. VIN lookup with full price history",
    sql: `SELECT l.source, l.price_cents, l.status, ph.price_cents AS history_price, ph.observed_at
          FROM listings l
          LEFT JOIN price_history ph ON ph.listing_id = l.id
          WHERE l.vin = (SELECT vin FROM listings WHERE status = 'active' LIMIT 1)
          ORDER BY ph.observed_at`,
    params: [],
  },
  {
    name: "4. Recently listed active listings in a province (pagination)",
    sql: `SELECT id, vin, make, model, price_cents, listed_at FROM listings
          WHERE status = 'active' AND province = $1
          ORDER BY listed_at DESC LIMIT 50`,
    params: ["QC"],
  },
  {
    name: "5. Price drops: listings whose latest price is below their previous price",
    sql: `WITH price_changes AS (
            SELECT listing_id, vin, price_cents, observed_at,
                   LAG(price_cents) OVER (PARTITION BY listing_id ORDER BY observed_at) AS prev_price
            FROM price_history
          )
          SELECT vin, prev_price, price_cents,
                 round(100.0 * (prev_price - price_cents) / NULLIF(prev_price, 0), 1) AS pct_drop
          FROM price_changes
          WHERE prev_price IS NOT NULL AND price_cents < prev_price
          ORDER BY pct_drop DESC LIMIT 20`,
    params: [],
  },
];

function parseArgs(argv: string[]) {
  const i = argv.indexOf("--label");
  return { label: i === -1 ? "run" : argv[i + 1] };
}

async function main() {
  const { label } = parseArgs(process.argv.slice(2));
  const pool = getPool();
  console.log(`=== Query benchmark: ${label} ===\n`);

  for (const q of QUERIES) {
    const res = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`, q.params);
    const plan = res.rows.map((r: any) => r["QUERY PLAN"]).join("\n");
    const totalTimeMatch = plan.match(/Execution Time: ([\d.]+) ms/);
    console.log(`${q.name}`);
    console.log(`  Execution Time: ${totalTimeMatch ? totalTimeMatch[1] + " ms" : "n/a"}`);
    const usesIndex = /Index Scan|Index Only Scan|Bitmap Index Scan/.test(plan);
    const usesSeqScan = /Seq Scan/.test(plan);
    console.log(`  Plan: ${usesIndex ? "index scan" : usesSeqScan ? "seq scan" : "other"}`);
    console.log();
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Query benchmark failed:", err);
  process.exit(1);
});
