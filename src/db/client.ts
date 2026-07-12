import pg from "pg";
import { config } from "dotenv";

// override: true — the ambient shell carries stale DATABASE_URL/CARDOG_API_KEY
// values that would otherwise shadow the corrected ones in .env.
config({ override: true });

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}
