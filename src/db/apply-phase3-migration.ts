import { readFileSync } from "node:fs";
import { getPool } from "./client.js";

async function main() {
  const sql = readFileSync(new URL("./phase3-migration.sql", import.meta.url), "utf-8");
  const pool = getPool();
  console.log("Applying phase3-migration.sql to Neon...");
  await pool.query(sql);
  console.log("Migration applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to apply phase3 migration:", err);
  process.exit(1);
});
