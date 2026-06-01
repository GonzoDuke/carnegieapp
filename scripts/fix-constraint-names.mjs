// One-off reconciliation: rename four constraints from the old Postgres
// auto-generated names (left behind by scripts/migrate-multitenant.mjs)
// to drizzle's naming convention, so `drizzle-kit push` stops seeing
// phantom drift — and stops offering to truncate the users table.
//   node scripts/fix-constraint-names.mjs
//
// RENAME CONSTRAINT is metadata-only: it changes a name, not a single row
// of data, and runs instantly. Idempotent — each rename checks the current
// name first, so it's safe to re-run and safe if some were already fixed.
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

// [table, oldName, newName]. Names are hardcoded literals (never user
// input), so interpolating them into the DDL below is safe.
const RENAMES = [
  ["users", "users_passcode_hash_key", "users_passcode_hash_unique"],
  ["batches", "batches_owner_id_fkey", "batches_owner_id_users_id_fk"],
  ["books", "books_owner_id_fkey", "books_owner_id_users_id_fk"],
  ["vision_usage", "vision_usage_owner_id_fkey", "vision_usage_owner_id_users_id_fk"],
];

const dbUrl = loadEnv("DATABASE_URL");
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function constraintExists(name) {
  const res = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1`,
    [name],
  );
  return res.rows.length > 0;
}

try {
  for (const [table, oldName, newName] of RENAMES) {
    if (await constraintExists(newName)) {
      console.log(`skip: ${newName} already present`);
      continue;
    }
    if (!(await constraintExists(oldName))) {
      console.log(`skip: ${oldName} not found (nothing to rename)`);
      continue;
    }
    await pool.query(
      `ALTER TABLE ${table} RENAME CONSTRAINT ${oldName} TO ${newName}`,
    );
    console.log(`renamed: ${oldName} -> ${newName}`);
  }
  console.log("\nDone. Constraint names now match drizzle's convention.");
} finally {
  await pool.end();
}
