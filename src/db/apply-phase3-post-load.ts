import { readFileSync } from "node:fs";
import { getPool } from "./client.js";

async function main() {
  const sql = readFileSync(new URL("./phase3-post-load.sql", import.meta.url), "utf-8");
  const pool = getPool();
  console.log("Applying phase3-post-load.sql to Neon (indexes + gold views)...");
  await pool.query(sql);
  console.log("Applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to apply phase3 post-load:", err);
  process.exit(1);
});
