// READ-ONLY diagnostic: dumps every constraint across all public tables so
// we can see which constraint NAMES differ from drizzle's conventions
// (the source of the db:push drift). Runs only SELECTs — changes nothing.
//   node scripts/inspect-users-constraints.mjs
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

const dbUrl = loadEnv("DATABASE_URL");
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

try {
  const constraints = await pool.query(`
    SELECT rel.relname AS table,
           con.conname AS name,
           CASE con.contype WHEN 'p' THEN 'pk' WHEN 'u' THEN 'unique'
                            WHEN 'f' THEN 'fk' WHEN 'c' THEN 'check'
                            ELSE con.contype::text END AS type,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
    ORDER BY rel.relname, con.contype, con.conname
  `);

  console.log("\n=== all public constraints ===");
  console.table(constraints.rows);
} finally {
  await pool.end();
}
