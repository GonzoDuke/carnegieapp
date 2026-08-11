// One-off migration: add books.upload_id — the link from a book back to the
// photo it was extracted from. Run from the repo root:
//   node scripts/add-book-upload-id.mjs
//
// Applied by hand rather than `drizzle-kit push` for the same reason as the
// other scripts here: push trips on pre-existing constraint drift and has
// historically offered to TRUNCATE users. These statements are additive,
// idempotent (IF NOT EXISTS), and touch nothing else, so this is safe to
// re-run and safe to run against a live database while the old code is
// still deployed — nothing reads the column until the new build ships.
//
// ON DELETE SET NULL is load-bearing: deleting a photo must never delete the
// books it found. Existing rows get NULL and can't be backfilled — a batch
// can have many photos and nothing recorded which book came from which.
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
  const { rows: before } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'books' AND column_name = 'upload_id'`,
  );
  console.log("upload_id already present:", before.length > 0);

  console.log("\n--- statements ---");
  console.log(
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS upload_id uuid\n" +
      "  REFERENCES batch_uploads(id) ON DELETE SET NULL;",
  );
  console.log("CREATE INDEX IF NOT EXISTS books_upload_idx ON books (upload_id);");

  await pool.query(
    `ALTER TABLE books ADD COLUMN IF NOT EXISTS upload_id uuid
       REFERENCES batch_uploads(id) ON DELETE SET NULL`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS books_upload_idx ON books (upload_id)`,
  );

  const { rows: after } = await pool.query(
    `SELECT c.column_name, c.data_type, c.is_nullable
       FROM information_schema.columns c
      WHERE c.table_name = 'books' AND c.column_name = 'upload_id'`,
  );
  const { rows: fks } = await pool.query(
    `SELECT conname, confdeltype FROM pg_constraint
      WHERE conrelid = 'books'::regclass AND contype = 'f'`,
  );
  const { rows: counts } = await pool.query(
    `SELECT COUNT(*)::int AS n, COUNT(upload_id)::int AS linked FROM books`,
  );

  console.log("\n--- result ---");
  console.log("column:", JSON.stringify(after[0] ?? null));
  console.log(
    "books FKs (confdeltype n = SET NULL, c = CASCADE):",
    fks.map((f) => `${f.conname}=${f.confdeltype}`).join(", "),
  );
  console.log(`rows: ${counts[0].n} books, ${counts[0].linked} linked to a photo`);
} finally {
  await pool.end();
}
