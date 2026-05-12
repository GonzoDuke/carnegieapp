// One-shot diagnostic: count batch_uploads rows and show the most recent
// few so we can tell whether the Blob-upload path is working in
// production after a new photo lands.
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

const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM batch_uploads`;
console.log(`batch_uploads total rows: ${n}`);

if (n > 0) {
  const rows = await sql`
    SELECT u.id, u.batch_id, u.blob_url, u.uploaded_at, u.detected_count,
           u.inserted_count, b.name AS batch_name
    FROM batch_uploads u JOIN batches b ON b.id = u.batch_id
    ORDER BY u.uploaded_at DESC LIMIT 10
  `;
  for (const r of rows) {
    console.log(
      `  ${r.uploaded_at}  batch="${r.batch_name}"  detected=${r.detected_count}  inserted=${r.inserted_count}  url=${r.blob_url.slice(0, 60)}…`,
    );
  }
} else {
  console.log("No batch_uploads rows exist. The vision route hasn't successfully written one yet.");
  console.log("Possible reasons:");
  console.log("  1. No photo has been uploaded SINCE the deploy.");
  console.log("  2. BLOB_READ_WRITE_TOKEN isn't reaching the production function — check Vercel env vars.");
  console.log("  3. The Vercel deploy hasn't finished — check the Vercel dashboard.");
}
