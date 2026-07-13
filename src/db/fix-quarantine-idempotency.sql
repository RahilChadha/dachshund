-- Fixes a real bug hit during pipeline retries: insertQuarantineBatch had no
-- dedup key, so re-running the pipeline against the same bronze batches
-- (which happened 3x while debugging the Neon storage-cap issue) reinserted
-- the same ~80K rejected records every time. quarantine grew to 240,990 rows
-- (170MB) — almost entirely duplicate data — which was itself consuming
-- most of the 512MB storage budget the real load needs.
--
-- Clearing here rather than deduplicating in place: every row in this table
-- is fully reproducible by re-running validate against bronze (the real,
-- immutable source of truth in R2), so nothing irreplaceable is lost — the
-- next successful pipeline run repopulates it correctly, and with the
-- content_hash unique constraint below, it will never duplicate again.
TRUNCATE quarantine;

ALTER TABLE quarantine ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE quarantine ALTER COLUMN content_hash SET NOT NULL;
ALTER TABLE quarantine ADD CONSTRAINT quarantine_source_batch_hash_key UNIQUE (source, batch_id, content_hash);
