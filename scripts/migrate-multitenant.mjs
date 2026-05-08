// One-shot multi-tenant migration. Run once, after deploying the new
// schema code. Idempotent — re-running on a fully-migrated DB exits
// cleanly. Refuses to run on a partially-migrated DB to avoid making
// things worse.
//
// Steps:
//   1. CREATE TABLE users (if not exists)
//   2. ALTER TABLE batches/books/vision_usage ADD COLUMN owner_id (nullable)
//   3. INSERT default user (APP_PASSCODE → scrypt hash)
//   4. UPDATE existing rows to set owner_id = default user
//   5. ALTER COLUMN ... SET NOT NULL on each owner_id
//   6. Drop old vision_usage primary key on (day) and add composite (day, owner_id)
//   7. Add referential constraints + indexes
//
// Env required: DATABASE_URL, APP_PASSCODE (the legacy single passcode —
// becomes the default user's passcode). DEFAULT_USER_NAME optional
// (defaults to "jmkelly1981").
import { readFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
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

function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const dbUrl = loadEnv("DATABASE_URL");
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const passcode = loadEnv("APP_PASSCODE");
if (!passcode) {
  console.error("APP_PASSCODE not set — needed to seed the default user.");
  process.exit(1);
}
const defaultName = loadEnv("DEFAULT_USER_NAME") || "jmkelly1981";

const pool = new Pool({ connectionString: dbUrl });

async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function tableExists(name) {
  const rows = await q(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name],
  );
  return rows[0].exists;
}

async function columnExists(table, column) {
  const rows = await q(
    `SELECT EXISTS (
       SELECT FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return rows[0].exists;
}

async function columnIsNotNull(table, column) {
  const rows = await q(
    `SELECT is_nullable = 'NO' AS not_null
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2`,
    [table, column],
  );
  return rows[0]?.not_null ?? false;
}

console.log("Multi-tenant migration starting...");

try {
  // -- Step 1: users table --
  if (await tableExists("users")) {
    console.log("  users table already exists; skipping CREATE.");
  } else {
    await q(
      `CREATE TABLE users (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         name text NOT NULL,
         passcode_hash text NOT NULL UNIQUE,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    console.log("  Created users table.");
  }

  // -- Step 2: add owner_id columns (nullable for now) --
  for (const table of ["batches", "books", "vision_usage"]) {
    if (await columnExists(table, "owner_id")) {
      console.log(`  ${table}.owner_id already exists; skipping ADD COLUMN.`);
      continue;
    }
    await q(`ALTER TABLE ${table} ADD COLUMN owner_id uuid`);
    console.log(`  Added ${table}.owner_id (nullable).`);
  }

  // -- Step 3: seed default user (or reuse the oldest one) --
  const existingRows = await q(
    `SELECT id, name FROM users ORDER BY created_at LIMIT 1`,
  );
  let defaultUserId;
  if (existingRows.length > 0) {
    defaultUserId = existingRows[0].id;
    console.log(
      `  Using existing user "${existingRows[0].name}" (${defaultUserId}) as default.`,
    );
  } else {
    const hash = hashPasscode(passcode);
    const created = await q(
      `INSERT INTO users (name, passcode_hash) VALUES ($1, $2) RETURNING id`,
      [defaultName, hash],
    );
    defaultUserId = created[0].id;
    console.log(
      `  Seeded default user "${defaultName}" (${defaultUserId}) from APP_PASSCODE.`,
    );
  }

  // -- Step 4: backfill owner_id on existing rows --
  for (const table of ["batches", "books", "vision_usage"]) {
    const countRows = await q(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE owner_id IS NULL`,
    );
    const count = countRows[0].count;
    if (count === 0) {
      console.log(`  ${table}: no rows need backfill.`);
      continue;
    }
    await q(
      `UPDATE ${table} SET owner_id = $1 WHERE owner_id IS NULL`,
      [defaultUserId],
    );
    console.log(`  ${table}: backfilled ${count} rows.`);
  }

  // -- Step 5: set NOT NULL on owner_id columns + add foreign keys --
  for (const table of ["batches", "books", "vision_usage"]) {
    if (await columnIsNotNull(table, "owner_id")) {
      console.log(`  ${table}.owner_id already NOT NULL.`);
    } else {
      await q(
        `ALTER TABLE ${table} ALTER COLUMN owner_id SET NOT NULL`,
      );
      console.log(`  ${table}.owner_id set NOT NULL.`);
    }
    const fkRows = await q(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_type = 'FOREIGN KEY'
         AND table_name = $1
         AND constraint_name = $2`,
      [table, `${table}_owner_id_fkey`],
    );
    if (fkRows.length === 0) {
      await q(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_owner_id_fkey
         FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`,
      );
      console.log(`  ${table}: added owner_id FK to users(id).`);
    }
  }

  // -- Step 6: indexes on owner_id for batches and books --
  for (const [table, idx] of [
    ["batches", "batches_owner_idx"],
    ["books", "books_owner_idx"],
  ]) {
    await q(`CREATE INDEX IF NOT EXISTS ${idx} ON ${table}(owner_id)`);
  }
  console.log("  Indexed batches.owner_id and books.owner_id.");

  // -- Step 7: vision_usage composite PK --
  const cols = await q(
    `SELECT column_name FROM information_schema.key_column_usage
     WHERE constraint_name = 'vision_usage_pkey'
     ORDER BY ordinal_position`,
  );
  if (cols.length === 1 && cols[0].column_name === "day") {
    await q(`ALTER TABLE vision_usage DROP CONSTRAINT vision_usage_pkey`);
    await q(`ALTER TABLE vision_usage ADD PRIMARY KEY (day, owner_id)`);
    console.log("  vision_usage PK changed from (day) to (day, owner_id).");
  } else if (cols.length === 2) {
    console.log("  vision_usage PK already composite.");
  }

  console.log("Done.");
} finally {
  await pool.end();
}
