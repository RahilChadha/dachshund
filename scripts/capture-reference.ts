/**
 * ONE-TIME schema calibration script. Per PROJECT_BRIEF.md's API budget rule:
 * this must run at most once, make at most 10 Cardog API calls, and never run
 * again after reference/real-listings.json exists. It makes exactly ONE call
 * (limit=10) rather than 10 separate calls, since /v1/listings/search
 * supports a `limit` parameter — no reason to spend the budget 10x over.
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { config } from "dotenv";

// override: true because the ambient shell has a stale CARDOG_API_KEY
// placeholder ("YOUR-CARDOG-KEY") that would otherwise shadow the real
// value in .env — dotenv does not overwrite existing process.env vars by default.
config({ override: true });

const OUT_PATH = "reference/real-listings.json";
const CARDOG_BASE_URL = "https://api.cardog.app/v1";

async function main() {
  if (existsSync(OUT_PATH)) {
    console.error(
      `Refusing to run: ${OUT_PATH} already exists. This script is one-time-only ` +
        `per the API budget rule — delete the file yourself if you are certain you want to re-spend calls.`
    );
    process.exit(1);
  }

  const apiKey = process.env.CARDOG_API_KEY;
  if (!apiKey || apiKey === "your-cardog-key" || apiKey.toUpperCase() === "YOUR-CARDOG-KEY") {
    console.error("CARDOG_API_KEY is missing or a placeholder. Aborting before spending any calls.");
    process.exit(1);
  }

  const url = `${CARDOG_BASE_URL}/listings/search?limit=10`;
  console.log(`Making 1 Cardog API call: GET ${url}`);

  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Cardog API call failed: ${res.status} ${res.statusText}\n${body}`);
    process.exit(1);
  }

  const data = await res.json();

  mkdirSync("reference", { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));

  console.log(`Saved raw response to ${OUT_PATH}`);

  const listings: unknown = (data as any).listings ?? (data as any).data ?? data;
  const sample = Array.isArray(listings) ? listings[0] : undefined;

  console.log(`\nCalls spent: 1 (of the 10 allowed by the budget rule)`);
  console.log(`Listing count returned: ${Array.isArray(listings) ? listings.length : "unknown (response was not an array)"}`);
  if (sample && typeof sample === "object") {
    console.log(`\nObserved fields on first listing: ${Object.keys(sample).join(", ")}`);
    console.log(`Has coordinates (lat/lng)? ${"lat" in sample || "lng" in sample || "coordinates" in sample || "location" in sample}`);
  } else {
    console.log("Top-level response keys:", Object.keys(data as object).join(", "));
  }
}

main().catch((err) => {
  console.error("capture-reference failed:", err);
  process.exit(1);
});
