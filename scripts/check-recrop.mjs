// Show the most recent vision-source books with rawVision.recropOf set —
// these came from the Crop & re-read flow. Inspects what coord rect was
// passed and what title came back.
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

const rows = await sql`
  SELECT id, title, authors, isbn_13, raw_vision, created_at
  FROM books
  WHERE source = 'vision' AND raw_vision->>'recropOf' IS NOT NULL
  ORDER BY created_at DESC LIMIT 10
`;

console.log(`Recent recrop results: ${rows.length}`);
for (const r of rows) {
  const rv = r.raw_vision ?? {};
  const vision = rv.vision ?? {};
  console.log(`
  [${r.created_at}]  upload_id=${rv.recropOf}
    -- vision saw --
    title       : "${vision.title}"
    author      : ${vision.author ? `"${vision.author}"` : "(null)"}
    confidence  : ${vision.confidence}
    visible_isbn: ${vision.visible_isbn ?? "(null)"}
    spine_class : ${vision.spine_classification ?? "(null)"}
    -- lookup chain returned --
    title saved : "${r.title}"
    authors     : ${JSON.stringify(r.authors)}
    isbn13      : ${r.isbn_13 ?? "(null)"}
    source      : ${rv.lookupSource ?? "(null)"}
    -- crop --
    rect (norm) : x=${rv.cropRect?.x?.toFixed(3)} y=${rv.cropRect?.y?.toFixed(3)} w=${rv.cropRect?.width?.toFixed(3)} h=${rv.cropRect?.height?.toFixed(3)}
    model       : ${rv.model}`);
}
