import type { Pool } from "pg";
import type { DecodeResult } from "@cardog/corgi";
import type { EnrichDeps } from "./enrich.js";

export function makeDbBackedCache(pool: Pool): Pick<EnrichDeps, "cacheGet" | "cacheSet"> {
  return {
    async cacheGet(prefixes) {
      if (prefixes.length === 0) return new Map();
      const res = await pool.query<{ wmi_vds_prefix: string; decoded: DecodeResult }>(
        `SELECT wmi_vds_prefix, decoded FROM decode_cache WHERE wmi_vds_prefix = ANY($1)`,
        [prefixes]
      );
      return new Map(res.rows.map((r) => [r.wmi_vds_prefix, r.decoded]));
    },
    async cacheSet(entries) {
      if (entries.length === 0) return;
      const values: string[] = [];
      const params: unknown[] = [];
      entries.forEach((e, i) => {
        values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
        params.push(e.prefix, JSON.stringify(e.decoded));
      });
      await pool.query(
        `INSERT INTO decode_cache (wmi_vds_prefix, decoded) VALUES ${values.join(",")} ON CONFLICT (wmi_vds_prefix) DO NOTHING`,
        params
      );
    },
  };
}
