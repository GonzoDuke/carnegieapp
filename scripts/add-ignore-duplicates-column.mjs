// One-off migration: add users.ignore_duplicates (account-wide mute for
// duplicate warnings). Run from the repo root:
//   node scripts/add-ignore-duplicates-column.mjs
//
// Applied by hand rather than `drizzle-kit push` because push currently
// trips on a pre-existing constraint drift (it wants to (re)add
// users_passcode_hash_unique and prompts to TRUNCATE users — a no-go).
// This statement is additive, idempotent (IF NOT EXISTS), and touches
// nothing else, so it's safe to re-run.
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
  await pool.query(
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS ignore_duplicates boolean NOT NULL DEFAULT false`,
  );
  console.log("OK: users.ignore_duplicates is present (NOT NULL DEFAULT false).");
} finally {
  await pool.end();
}
