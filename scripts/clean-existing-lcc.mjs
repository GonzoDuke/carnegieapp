// One-shot: backfill the LCC cleanup over rows that were saved before
// cleanLcc landed in the OL projection. Idempotent — already-clean
// rows are unchanged. Reports counts.
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

// Postgres regex mirror of cleanLcc:
//   1. ([A-Z]{1,3})-+0*(\d+)  →  $1$2
//   2. \.0{4,}                →  ""
//   3. collapse whitespace, trim
// Only touches rows where the LCC actually shows signs of padding,
// so the count is meaningful and rows that were already clean don't
// take an unnecessary write.
const candidates = await sql`
  SELECT id, lcc FROM books
  WHERE lcc IS NOT NULL
    AND (lcc LIKE '%--%' OR lcc ~ '\\.0{4,}')
`;
console.log(`Rows with padded LCCs: ${candidates.length}`);

let updated = 0;
for (const r of candidates) {
  const before = r.lcc;
  const after = before
    .replace(/([A-Z]{1,3})-+0*(\d+)/g, "$1$2")
    .replace(/\.0{4,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (after === before) continue;
  await sql`UPDATE books SET lcc = ${after} WHERE id = ${r.id}`;
  console.log(`  ${before}  →  ${after}`);
  updated++;
}
console.log(`Updated ${updated} row(s).`);
