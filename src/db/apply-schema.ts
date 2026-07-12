import { readFileSync } from "node:fs";
import { getPool } from "./client.js";

async function main() {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf-8");
  const pool = getPool();
  console.log("Applying schema.sql to Neon...");
  await pool.query(sql);
  console.log("Schema applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to apply schema:", err);
  process.exit(1);
});
