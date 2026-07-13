-- Phase 3 pre-load migration: schema changes only. Index creation and
-- materialized views are deliberately NOT here — see phase3-post-load.sql.
--
-- Building indexes incrementally during a 921K-row bulk INSERT (maintaining
-- every index on every row as it's inserted) costs meaningfully more
-- transient space than bulk-building the same index once after the data
-- exists — the difference was the last few percent that made the load fit
-- inside Neon's 512MB free-tier cap. This is also just the correct order for
-- an honest before/after index benchmark: the "before" EXPLAIN ANALYZE has
-- to run against a real index-free table, not one that happens to have the
-- index already built during load.

-- Deliberate denormalization: make/model/model_year copied onto listings so
-- the composite index (added post-load) serves the make/model/year/province
-- filter shape without a join through vehicles. Flagged as a placeholder
-- decision back in schema.sql during Phase 1 — kept normalized-only until
-- there was a real query + EXPLAIN ANALYZE to justify the trade-off.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS make TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS model_year SMALLINT;

-- Groups every pipeline_runs row from one `npm run pipeline` execution
-- together, so metrics reporting can aggregate "this run" instead of
-- accidentally summing stage rows across multiple historical attempts
-- (e.g. a crashed run retried after a bug fix).
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS run_id UUID;
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_run_id ON pipeline_runs (run_id);

-- Idempotent backfill: only touches rows that haven't been filled yet, so
-- re-running this migration (or a future replay) doesn't redo the work.
-- (No-op on a fresh load, since load.ts now populates make/model/model_year
-- directly — kept for safety against older rows loaded before that change.)
UPDATE listings
SET make = v.make, model = v.model, model_year = v.model_year
FROM vehicles v
WHERE v.vin = listings.vin AND listings.make IS NULL;
