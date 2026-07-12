-- Dachshund silver-layer schema (Neon Postgres).
-- Bronze lives in R2 as immutable NDJSON/CSV; everything here is derived,
-- so every table can in principle be dropped and rebuilt by `npm run replay`.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- vehicles: one row per PHYSICAL vehicle, keyed by VIN. This is the
-- deduplicated, "trusted" view — fields here are corgi-decoded or
-- survivorship-resolved, never raw-from-source. A vehicle can be backed by
-- listings from multiple sources/times; this table doesn't know about that.
-- ---------------------------------------------------------------------------
CREATE TABLE vehicles (
    vin              CHAR(17) PRIMARY KEY,
    wmi              CHAR(3)  NOT NULL,           -- first 3 chars, used for decode_cache lookups
    make             TEXT,
    model            TEXT,
    model_year       SMALLINT,                    -- from VIN position 10 decode, may disagree with a listing's stated year
    trim             TEXT,                        -- canonicalized trim, corgi-decoded where possible
    body_style       TEXT,
    fuel_type        TEXT,
    drive_train      TEXT,
    transmission     TEXT,
    decode_source    TEXT NOT NULL DEFAULT 'undecoded', -- 'corgi' | 'undecoded' — lets us find vehicles enrich missed
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- listings: one row per (source, source_listing_id) — i.e. one row per
-- observed ad, not per vehicle. Multiple listings can point at the same VIN
-- (that's the cross-source dedup problem the brief describes). The unique
-- constraint on (source, source_listing_id) is what makes the load stage
-- idempotent: re-processing the same bronze batch upserts instead of
-- duplicating.
-- ---------------------------------------------------------------------------
CREATE TABLE listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vin                 CHAR(17) NOT NULL REFERENCES vehicles(vin),
    source              TEXT NOT NULL,             -- 'dealer_feed_a' | 'marketplace_b'
    source_listing_id   TEXT NOT NULL,              -- id/stockNumber as it appeared in the raw feed
    batch_id            TEXT NOT NULL,              -- bronze object key this row was loaded from (replay/audit trail)
    price_cents         BIGINT,                     -- integer cents avoids float rounding on money
    currency            TEXT NOT NULL DEFAULT 'CAD',
    odometer_km         INTEGER,                    -- always km after normalize stage unifies miles->km
    trim_raw             TEXT,                      -- exactly as scraped, pre-canonicalization (EX-L / EXL / EX L Navi ...)
    province             TEXT,
    city                 TEXT,
    latitude              NUMERIC(9,6),
    longitude             NUMERIC(9,6),
    status                TEXT NOT NULL DEFAULT 'active', -- 'active' | 'removed'
    year_conflict         BOOLEAN NOT NULL DEFAULT false, -- true if source year disagreed with corgi's VIN decode (decode wins, this just flags it)
    listed_at             TIMESTAMPTZ,
    delisted_at           TIMESTAMPTZ,
    raw_payload           JSONB NOT NULL,            -- the original (filthy) record, kept for audits/replays without needing bronze
    make                  TEXT,                      -- denormalized from vehicles (decode-trusted), so gold queries don't need a join — see phase3-migration.sql
    model                 TEXT,
    model_year            SMALLINT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_listing_id)
);

CREATE INDEX idx_listings_vin ON listings (vin);
-- Composite index for the make/model/year/province filter shape (gold
-- market-stats queries and most "browse listings" access patterns) and a
-- partial index for the common "active listings only" case — both created
-- in src/db/phase3-migration.sql alongside the before/after EXPLAIN ANALYZE
-- benchmark that justified them.

-- ---------------------------------------------------------------------------
-- price_history: append-only. A new row is written whenever the SAME VIN is
-- re-seen with a DIFFERENT price (not on every re-observation), so this
-- table tracks actual price changes, not scrape frequency.
-- ---------------------------------------------------------------------------
CREATE TABLE price_history (
    id             BIGSERIAL PRIMARY KEY,
    vin            CHAR(17) NOT NULL REFERENCES vehicles(vin),
    listing_id     UUID NOT NULL REFERENCES listings(id),
    price_cents    BIGINT NOT NULL,
    observed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_history_vin ON price_history (vin, observed_at);

-- ---------------------------------------------------------------------------
-- quarantine: every record that fails validation lands here with a reason
-- code, never silently dropped. reason_codes is an array because a single
-- record can fail multiple checks at once (bad check digit AND missing price).
-- ---------------------------------------------------------------------------
CREATE TABLE quarantine (
    id             BIGSERIAL PRIMARY KEY,
    source         TEXT NOT NULL,
    batch_id       TEXT NOT NULL,
    raw_record     JSONB NOT NULL,
    reason_codes   TEXT[] NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ                        -- set if a later fix/replay resolves it; null = still aging
);

CREATE INDEX idx_quarantine_unresolved ON quarantine (source, quarantined_at) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- pipeline_runs / quality_metrics: observability. Every stage of every batch
-- writes one pipeline_runs row (rows_in/out/rejects/duration) and N
-- quality_metrics rows keyed to that run, so quality can be queried
-- per-source-per-run without re-deriving it from the data tables.
-- ---------------------------------------------------------------------------
CREATE TABLE pipeline_runs (
    id             BIGSERIAL PRIMARY KEY,
    stage          TEXT NOT NULL,        -- 'extract' | 'validate' | 'normalize' | 'dedupe' | 'enrich' | 'load'
    source         TEXT NOT NULL,
    batch_id       TEXT NOT NULL,
    rows_in        INTEGER NOT NULL,
    rows_out       INTEGER NOT NULL,
    rejects        INTEGER NOT NULL DEFAULT 0,
    started_at     TIMESTAMPTZ NOT NULL,
    finished_at    TIMESTAMPTZ NOT NULL,
    duration_ms    INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'success' -- 'success' | 'failed'
);

CREATE INDEX idx_pipeline_runs_batch ON pipeline_runs (batch_id, stage);

CREATE TABLE quality_metrics (
    id             BIGSERIAL PRIMARY KEY,
    run_id         BIGINT NOT NULL REFERENCES pipeline_runs(id),
    source         TEXT NOT NULL,
    metric_name    TEXT NOT NULL,   -- e.g. 'rejection_rate', 'field_completeness_pct', 'duplicate_rate', 'decode_success_rate'
    metric_value   NUMERIC NOT NULL,
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quality_metrics_run ON quality_metrics (run_id, metric_name);

-- ---------------------------------------------------------------------------
-- decode_cache: memoizes @cardog/corgi decode results by WMI+VDS prefix
-- (VIN positions 1-11), since positions 12-17 are the plant/serial suffix
-- and don't affect the make/model/trim decode. Avoids re-decoding the same
-- vehicle configuration thousands of times across a 1M-row batch.
-- ---------------------------------------------------------------------------
CREATE TABLE decode_cache (
    wmi_vds_prefix   CHAR(11) PRIMARY KEY,
    decoded          JSONB NOT NULL,
    decoded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
