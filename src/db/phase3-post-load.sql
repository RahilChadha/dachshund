-- Run after the bulk load completes (npm run db:apply-phase3-post-load).
-- Building these here — after data exists — rather than before load
-- keeps the load itself under Neon's storage cap (see phase3-migration.sql)
-- and, more importantly, is what makes the before/after EXPLAIN ANALYZE
-- benchmark in BENCHMARKS.md honest: "before" ran with these indexes
-- genuinely absent, not just recently built.

-- Composite index for the make/model/year/province filter shape used by
-- the gold market-stats queries and most "browse listings" access patterns.
CREATE INDEX IF NOT EXISTS idx_listings_make_model_year_province
  ON listings (make, model, model_year, province);

-- Partial index: most queries only care about currently-active listings,
-- and 'active' status listings are the overwhelming minority of total row
-- churn over time (removed listings pile up but are rarely queried) — a
-- partial index keeps the index small and fast for the common case.
CREATE INDEX IF NOT EXISTS idx_listings_active
  ON listings (vin)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Gold layer: materialized views. Refreshed on demand, not on every write —
-- market stats don't need to be real-time-consistent.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS gold_market_stats;
CREATE MATERIALIZED VIEW gold_market_stats AS
SELECT
  make,
  model,
  model_year,
  province,
  count(*) AS listing_count,
  round(avg(price_cents) / 100.0, 2) AS avg_price_cad,
  -- percentile_cont() returns double precision over a bigint column
  -- (no numeric/interval fast path), and round(double precision, int)
  -- doesn't exist in Postgres — needs an explicit numeric cast first.
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY price_cents))::numeric / 100.0, 2) AS median_price_cad,
  round(avg(odometer_km)) AS avg_odometer_km
FROM listings
WHERE status = 'active' AND price_cents IS NOT NULL AND make IS NOT NULL
GROUP BY make, model, model_year, province;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_market_stats_key
  ON gold_market_stats (make, model, model_year, province);

-- Price-drop analytics: LAG() over each listing's own price_history to find
-- the most recent drop (previous price -> current price) per listing.
DROP MATERIALIZED VIEW IF EXISTS gold_price_drops;
CREATE MATERIALIZED VIEW gold_price_drops AS
WITH price_changes AS (
  SELECT
    listing_id,
    vin,
    price_cents,
    observed_at,
    LAG(price_cents) OVER (PARTITION BY listing_id ORDER BY observed_at) AS previous_price_cents,
    LAG(observed_at) OVER (PARTITION BY listing_id ORDER BY observed_at) AS previous_observed_at
  FROM price_history
)
SELECT
  listing_id,
  vin,
  previous_price_cents,
  price_cents AS current_price_cents,
  (previous_price_cents - price_cents) AS price_drop_cents,
  round(100.0 * (previous_price_cents - price_cents) / NULLIF(previous_price_cents, 0), 2) AS price_drop_pct,
  previous_observed_at,
  observed_at AS current_observed_at
FROM price_changes
WHERE previous_price_cents IS NOT NULL AND price_cents < previous_price_cents;

CREATE INDEX IF NOT EXISTS idx_gold_price_drops_vin ON gold_price_drops (vin);
