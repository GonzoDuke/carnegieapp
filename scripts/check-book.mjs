// Diagnostic: dump the current state of the N most recently updated
// books across all batches, plus the most recent log entries we have
// access to. Useful for "why didn't re-lookup do anything" cases.
//
// Optionally pass a batch name to scope to that batch.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

const sql = neon(process.env.DATABASE_URL);
const batchName = process.argv[2];

const rows = batchName
  ? await sql`
      SELECT b.id, b.title, b.authors, b.isbn_13, b.isbn_10, b.cover_url,
             b.publisher, b.lcc, b.description, b.status, b.source,
             b.created_at, ba.name AS batch_name
      FROM books b JOIN batches ba ON ba.id = b.batch_id
      WHERE ba.name ILIKE ${batchName + "%"}
      ORDER BY b.created_at DESC LIMIT 10
    `
  : await sql`
      SELECT b.id, b.title, b.authors, b.isbn_13, b.isbn_10, b.cover_url,
             b.publisher, b.lcc, b.description, b.status, b.source,
             b.created_at, ba.name AS batch_name
      FROM books b JOIN batches ba ON ba.id = b.batch_id
      ORDER BY b.created_at DESC LIMIT 10
    `;

console.log(`${rows.length} most recent book row(s):\n`);
for (const r of rows) {
  console.log(
    `  [${r.created_at}]  batch="${r.batch_name}"  source=${r.source}  status=${r.status}`,
  );
  console.log(`    title    : "${r.title}"`);
  console.log(`    authors  : ${JSON.stringify(r.authors)}`);
  console.log(`    isbn_13  : ${r.isbn_13 ?? "(null)"}`);
  console.log(`    isbn_10  : ${r.isbn_10 ?? "(null)"}`);
  console.log(`    publisher: ${r.publisher ?? "(null)"}`);
  console.log(`    lcc      : ${r.lcc ?? "(null)"}`);
  console.log(`    cover_url: ${r.cover_url ? r.cover_url.slice(0, 80) + "…" : "(null)"}`);
  console.log(`    description: ${r.description ? r.description.slice(0, 80) + "…" : "(null)"}`);
  console.log("");
}
