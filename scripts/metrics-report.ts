/**
 * Prints a quality-metrics summary for the most recent pipeline run,
 * grouped by stage/source. Scoped to one run_id (not summed across every
 * historical attempt) so a retried run after a bug fix doesn't inflate
 * numbers with a crashed attempt's partial rows.
 *
 * Usage: npm run metrics:report [-- --run <uuid>]
 */
import { getPool } from "../src/db/client.js";

function parseArgs(argv: string[]) {
  const i = argv.indexOf("--run");
  return { run: i === -1 ? undefined : argv[i + 1] };
}

async function main() {
  const { run } = parseArgs(process.argv.slice(2));
  const pool = getPool();

  const runId =
    run ??
    (
      await pool.query<{ run_id: string }>(
        `SELECT run_id FROM pipeline_runs WHERE run_id IS NOT NULL ORDER BY started_at DESC LIMIT 1`
      )
    ).rows[0]?.run_id;

  if (!runId) {
    console.log("No pipeline runs found (with a run_id — older pre-Phase-3 rows aren't groupable).");
    await pool.end();
    return;
  }

  console.log(`=== Pipeline run ${runId} ===\n`);

  const stageRows = await pool.query<{
    stage: string; source: string; rows_in: string; rows_out: string; rejects: string; total_ms: string; batches: string;
  }>(
    `SELECT stage, source,
            sum(rows_in)::bigint AS rows_in, sum(rows_out)::bigint AS rows_out, sum(rejects)::bigint AS rejects,
            sum(duration_ms)::bigint AS total_ms, count(*)::bigint AS batches
     FROM pipeline_runs
     WHERE run_id = $1
     GROUP BY stage, source
     ORDER BY stage, source`,
    [runId]
  );

  console.log("Stage           Source            Rows In    Rows Out   Rejects   Batches   Total ms");
  console.log("-".repeat(90));
  for (const r of stageRows.rows) {
    console.log(
      `${r.stage.padEnd(16)}${r.source.padEnd(18)}${r.rows_in.padStart(9)}  ${r.rows_out.padStart(9)}  ${r.rejects.padStart(8)}  ${r.batches.padStart(8)}  ${r.total_ms.padStart(9)}`
    );
  }

  console.log("\n=== Quality metrics ===\n");
  const metricRows = await pool.query<{ source: string; metric_name: string; metric_value: string }>(
    `SELECT qm.source, qm.metric_name, qm.metric_value
     FROM quality_metrics qm
     JOIN pipeline_runs pr ON pr.id = qm.run_id
     WHERE pr.run_id = $1
     ORDER BY qm.source, qm.metric_name`,
    [runId]
  );
  for (const r of metricRows.rows) {
    const value = Number(r.metric_value);
    const formatted = Number.isInteger(value) ? value : value < 1 ? `${(value * 100).toFixed(2)}%` : value.toFixed(2);
    console.log(`  [${r.source}] ${r.metric_name}: ${formatted}`);
  }

  console.log("\n=== Quarantine reason codes (all-time) ===\n");
  const quarantineRows = await pool.query<{ reason: string; source: string; n: string }>(
    `SELECT unnest(reason_codes) AS reason, source, count(*)::bigint AS n
     FROM quarantine
     GROUP BY reason, source
     ORDER BY n DESC`
  );
  for (const r of quarantineRows.rows) {
    console.log(`  ${r.source.padEnd(18)} ${r.reason.padEnd(24)} ${r.n}`);
  }

  console.log("\n=== Silver table row counts ===\n");
  for (const t of ["vehicles", "listings", "price_history", "quarantine", "decode_cache"]) {
    const res = await pool.query(`SELECT count(*) FROM ${t}`);
    console.log(`  ${t.padEnd(16)} ${res.rows[0].count}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Metrics report failed:", err);
  process.exit(1);
});
