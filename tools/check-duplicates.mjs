// Read-only diagnostic: what does the prod DB actually say about
// duplicates right now? Runs the same logic the home page banner
// and /duplicates page use, so we can compare and find the gap.
//
// Usage: node tools/check-duplicates.mjs
// Requires DATABASE_URL in .env.local.

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadEnv() {
  const text = readFileSync(".env.local", "utf8");
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}
const sql = neon(env.DATABASE_URL);

// 1. Whose data are we looking at?
const users = await sql`SELECT id, name FROM users ORDER BY name`;
console.log("Users:");
for (const u of users) console.log(`  ${u.id}  ${u.name}`);

console.log("\n--- HOME PAGE BANNER LOGIC ---");
console.log("(same query the home page uses: canonical ISBN, count > 1, non-deleted batches)\n");
const homeDups = await sql`
  SELECT
    books.owner_id,
    COALESCE(books.isbn_13, books.isbn_10) AS canonical_isbn,
    COUNT(*) AS copies
  FROM books
  INNER JOIN batches ON books.batch_id = batches.id
  WHERE (books.isbn_13 IS NOT NULL OR books.isbn_10 IS NOT NULL)
    AND batches.deleted_at IS NULL
  GROUP BY books.owner_id, COALESCE(books.isbn_13, books.isbn_10)
  HAVING COUNT(*) > 1
  ORDER BY books.owner_id, canonical_isbn
`;
if (homeDups.length === 0) {
  console.log("  (no duplicates — home banner should NOT show)");
} else {
  for (const r of homeDups) {
    console.log(`  owner=${r.owner_id}  isbn=${r.canonical_isbn}  copies=${r.copies}`);
  }
}

console.log("\n--- HOME PAGE WITHOUT deletedAt FILTER (what an OLDER deploy would see) ---");
const homeDupsNoFilter = await sql`
  SELECT
    books.owner_id,
    COALESCE(books.isbn_13, books.isbn_10) AS canonical_isbn,
    COUNT(*) AS copies
  FROM books
  WHERE (books.isbn_13 IS NOT NULL OR books.isbn_10 IS NOT NULL)
  GROUP BY books.owner_id, COALESCE(books.isbn_13, books.isbn_10)
  HAVING COUNT(*) > 1
  ORDER BY books.owner_id, canonical_isbn
`;
if (homeDupsNoFilter.length === 0) {
  console.log("  (no duplicates even without the filter)");
} else {
  for (const r of homeDupsNoFilter) {
    console.log(`  owner=${r.owner_id}  isbn=${r.canonical_isbn}  copies=${r.copies}`);
  }
}

console.log("\n--- EVERY BOOK SHARING AN ISBN, INCLUDING SOFT-DELETED BATCHES ---");
const allCopies = await sql`
  SELECT
    books.owner_id,
    COALESCE(books.isbn_13, books.isbn_10) AS canonical_isbn,
    books.id AS book_id,
    books.title,
    books.status,
    batches.id AS batch_id,
    batches.name AS batch_name,
    batches.deleted_at AS batch_deleted_at
  FROM books
  INNER JOIN batches ON batches.id = books.batch_id
  WHERE (books.isbn_13 IS NOT NULL OR books.isbn_10 IS NOT NULL)
    AND COALESCE(books.isbn_13, books.isbn_10) IN (
      SELECT COALESCE(b.isbn_13, b.isbn_10)
      FROM books b
      WHERE b.isbn_13 IS NOT NULL OR b.isbn_10 IS NOT NULL
      GROUP BY COALESCE(b.isbn_13, b.isbn_10)
      HAVING COUNT(*) > 1
    )
  ORDER BY books.owner_id, canonical_isbn, batches.deleted_at NULLS FIRST
`;
if (allCopies.length === 0) {
  console.log("  (no books share an ISBN anywhere)");
} else {
  let lastIsbn = null;
  for (const r of allCopies) {
    if (r.canonical_isbn !== lastIsbn) {
      console.log(`\n  ISBN ${r.canonical_isbn}  (owner=${r.owner_id})`);
      lastIsbn = r.canonical_isbn;
    }
    const tag = r.batch_deleted_at ? "[batch DELETED]" : "[active]";
    console.log(`    ${tag}  "${r.title}"  status=${r.status}  batch="${r.batch_name}"  book_id=${r.book_id}`);
  }
}
