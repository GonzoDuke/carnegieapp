// Adds a new user. Run from the repo root:
//   node scripts/add-user.mjs --name="Alice" --passcode="abc123"
//
// Both flags required. Refuses to create a duplicate name (case-sensitive)
// to avoid confusion. The passcode is scrypt-hashed before insert; nothing
// recoverable is stored. Prints the new user id.
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

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const name = parseArg("name");
const passcode = parseArg("passcode");
if (!name || !passcode) {
  console.error("Usage: node scripts/add-user.mjs --name=\"Alice\" --passcode=\"...\"");
  process.exit(1);
}

const dbUrl = loadEnv("DATABASE_URL");
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

try {
  const existing = await pool.query(
    `SELECT id FROM users WHERE name = $1 LIMIT 1`,
    [name],
  );
  if (existing.rows.length > 0) {
    console.error(`A user named "${name}" already exists (${existing.rows[0].id}).`);
    process.exit(1);
  }
  const inserted = await pool.query(
    `INSERT INTO users (name, passcode_hash) VALUES ($1, $2) RETURNING id`,
    [name, hashPasscode(passcode)],
  );
  console.log(`Added user "${name}" (${inserted.rows[0].id}).`);
  console.log(`They can now log in with the passcode you supplied.`);
} finally {
  await pool.end();
}
