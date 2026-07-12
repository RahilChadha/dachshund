# PROJECT BRIEF: DACHSHUND

A mini version of Cardog's 'Crawldog' listings pipeline (Canadian automotive data startup, stack: TypeScript/Node, Cloudflare Workers, Postgres/Neon, their open-source VIN decoder @cardog/corgi). Named Dachshund in the spirit of Corgi and Crawldog. Goal: ETL pipelines for vehicle data ingestion, data quality and normalization at scale, deduplication, PostgreSQL optimization, strong SQL.

ARCHITECTURE (medallion): Bronze = raw immutable NDJSON/CSV batches in Cloudflare R2, partitioned by source/date, never edited, replayable. Silver = validated/normalized/deduplicated tables in Neon Postgres: vehicles (one row per physical vehicle, keyed by VIN), listings (one row per listing observation), price_history, quarantine (rejected records with reason codes), pipeline_runs + quality_metrics (observability). Gold = materialized views for market stats (avg/median price by make/model/year/province, price-drop analytics via window functions).

DATA SOURCES: (A) 'Dealer Feed A' — synthetic generator output, clean-ish JSON, English, CAD, km. (B) 'Marketplace B' — same generator, different profile: CSV, French field names (prix, kilometrage), some odometers secretly in miles, ~2% of VINs overlap with A carrying contradictory data (creates the dedup problem). (C) Real government feeds (stretch): Transport Canada recalls API, NHTSA recalls API. (D) Cardog API reference sample — ONE-TIME schema calibration only.

CRITICAL API BUDGET RULE: My Cardog API key (CARDOG_API_KEY env var) has only ~15 calls left. You may make AT MOST 10 calls, exactly once, in one script (scripts/capture-reference.ts) that fetches ~10 real listings and saves raw responses to reference/real-listings.json. After that file exists, NEVER call the Cardog API again — model the generator's schema on that file. Do not use any cardog MCP tools if configured.

GENERATOR REQUIREMENTS (src/generator): TypeScript, produces 1M+ listings as NDJSON (source A) and CSV (source B). VINs must be structurally real: valid WMIs from a seed list of ~30 real make/model/year combos sold in Canada, correct mod-11 check digit computed per ISO 3779 — with ~7% deliberately corrupted check digits and ~1% wrong length to test quarantine. Filth injection (configurable rates, plus a --chaos flag): price as number, '$34,999', '35 995 $' (Quebec format), or missing; odometer in km or unlabeled miles; trim spelled multiple ways (EX-L / EXL / EX L Navi); missing fields; duplicate VINs across sources with contradictory year/price; a few absurd price outliers. Deterministic with a --seed flag.

PIPELINE STAGES (src/pipeline): extract (land batches in R2 bronze) → validate (corgi check-digit + structure validation via @cardog/corgi as a library; failures to quarantine with reason codes, never silently dropped) → normalize (one module each: price parsing, km/miles unification storing km always, trim canonicalization against corgi's decoded trim, French field mapping — each with unit tests) → dedupe (VIN natural key; survivorship: freshest price wins, richest record fills gaps; same VIN re-seen with new price = price_history row; contradictory year vs corgi decode = trust the decode, flag the listing) → enrich (batch decode via corgi with decode_cache table memoized by WMI+VDS prefix) → load (Postgres COPY streaming, benchmarked vs row inserts) → observe (every stage writes rows-in/rows-out/rejects/duration to pipeline_runs and quality_metrics).

QUALITY METRICS (per source per run, stored in Postgres): rejection rate with reason codes, field completeness %, duplicate rate within/across sources, conflict rate, trim normalization coverage, price outlier rate (z-score per model), decode success rate, quarantine aging. Pipeline must be idempotent (same batch twice = no double rows) and replayable (npm run replay reprocesses bronze from R2).

ENGINEERING STANDARDS: TypeScript strict mode, small modules, vitest tests for every normalizer and the VIN check-digit logic, npm scripts for every command, .env for secrets with .env in .gitignore from the first commit, frequent git commits with conventional-commit messages. README.md with mermaid architecture diagram, benchmark table, quality metrics summary, and a 'judgment' section explaining the data-sourcing decision (synthetic-but-schema-accurate listings + real government data, because real listings at volume are proprietary — Crawldog already exists; the bottleneck is trusting what's fetched, so this is the trust machine).

## EXECUTION PLAN — run phases in order, PAUSE at each checkpoint for go-ahead

**PHASE 1 (foundations + extract):**
1. git init, package.json, tsconfig strict, vitest, folders (src/generator, src/pipeline, src/db, scripts, reference, test), .env + .gitignore.
2. scripts/capture-reference.ts — run ONCE (10-call cap) → reference/real-listings.json; report the schema observed, including whether listings carry coordinates.
3. Neon schema (src/db/schema.sql) with comments explaining each design choice; apply it.
4. Generator with VIN check-digit logic + tests, field names matching the reference file.
5. Generate 1M listings (A NDJSON, B CSV), write src/pipeline/extract.ts, land both in R2 bronze with source/date partitioning.
6. Verify: list R2 objects, row counts, tests green.
CHECKPOINT: summarize what exists + key design decisions, then WAIT for go-ahead to continue.

**PHASE 2 (transform):**
Validate stage with quarantine + reason codes; normalization modules (price, units, trim, French mapping) each with unit tests using the nastiest generator cases; VIN dedup with survivorship rules; corgi enrichment with decode_cache; quality metrics written at every stage; prove idempotency by running the same batch twice and showing counts don't double; implement npm run replay from bronze.
CHECKPOINT: show per-source quality metrics from the run, summarize, WAIT.

**PHASE 3 (load, optimize, observe, story):**
COPY vs row-insert benchmark with timings; 5 realistic queries benchmarked with EXPLAIN ANALYZE before/after composite index (make, model, year, province), partial index on active listings, and materialized gold views — all recorded in BENCHMARKS.md as a before/after table; price-drop analytics with LAG() window function; CLI metrics report; full README (architecture diagram, benchmarks, metrics, judgment section). Stretch if smooth: Transport Canada recalls enrichment joined by make/model/year.
FINAL: complete project summary + a list of every design decision worth documenting, phrased as Q&A.

Throughout: ask before any destructive operation, explain WHY at each major step in one or two sentences — this is a learning-oriented build.
