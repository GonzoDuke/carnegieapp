// Re-derive call numbers from the spine stickers vision already read.
//
// Two bugs put wrong values in books.lcc:
//
//   1. The old LC pattern required the class letters and class number to be
//      adjacent ("E184"). Real spine labels are printed stacked, so vision
//      reads them back spaced ("E 184 .A75 A125 2019"). The pattern couldn't
//      match, skipped ahead, and matched the CUTTER as if it were the class —
//      turning "DS 126.5 .R37 2008" into "R37 2008".
//
//   2. A lookup provider's LCC beat the sticker. Providers return other
//      editions, and sometimes other works: a book labelled "DT 20 .R45 2019"
//      was stored as "DT1787 .T48 2001".
//
// Both are fixed going forward. This repairs what's already in the database,
// using raw_vision->vision->spine_classification, which was captured verbatim
// at extraction time and is untouched by either bug.
//
// Dry run by default:
//   node scripts/backfill-spine-lcc.mjs
//   node scripts/backfill-spine-lcc.mjs --apply
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");

// Kept in sync with lib/lookup/classification.ts. Duplicated rather than
// imported because this script runs outside Next's module resolution.
const LCC_REGEX =
  /\b([A-Z]{1,3})\s*(\d{1,4}(?:\.\d+)?)((?:\s*\.\s*[A-Z]+\d+|\s+[A-Z]\d+)*)(?:\s+(\d{4}))?/;

function parseLcc(text) {
  if (!text) return null;
  const m = text.match(LCC_REGEX);
  if (!m) return null;
  const [, letters, number, cutterBlob, year] = m;
  const cutters = (cutterBlob || "")
    .split(/\s+|(?=\.)/)
    .map((c) => c.replace(/^\.+/, "").trim())
    .filter(Boolean);
  let value = `${letters}${number}`;
  if (cutters.length > 0) value += ` .${cutters[0]}`;
  if (cutters.length > 1) value += ` ${cutters.slice(1).join(" ")}`;
  if (year) value += ` ${year}`;
  return { value, complete: cutters.length > 0 };
}

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
  const { rows } = await pool.query(`
    SELECT b.id,
           b.title,
           b.lcc,
           b.raw_vision->'vision'->>'spine_classification' AS sticker,
           u.name AS owner
      FROM books b
      JOIN users u ON u.id = b.owner_id
     WHERE b.raw_vision->'vision'->>'spine_classification' IS NOT NULL
       AND b.raw_vision->'vision'->>'spine_classification' <> ''
       AND b.status <> 'rejected'
     ORDER BY u.name, b.title
  `);

  const changes = [];
  let unchanged = 0;
  let weak = 0;

  for (const r of rows) {
    const parsed = parseLcc(r.sticker);
    // Only overwrite when the sticker gives a complete call number — one
    // with a cutter. A bare class ("DT14") is a weaker claim than whatever
    // the lookup chain already found, so leave those alone.
    if (!parsed || !parsed.complete) {
      weak++;
      continue;
    }
    if (parsed.value === r.lcc) {
      unchanged++;
      continue;
    }
    changes.push({ ...r, next: parsed.value });
  }

  console.log(`books with a sticker read: ${rows.length}`);
  console.log(`  already correct:         ${unchanged}`);
  console.log(`  sticker too weak to use: ${weak}`);
  console.log(`  would change:            ${changes.length}\n`);

  const width = Math.max(...changes.map((c) => (c.lcc ?? "(none)").length), 12);
  console.log("OWNER".padEnd(6), "FROM".padEnd(width), "->", "TO");
  console.log("-".repeat(6 + width + 30));
  for (const c of changes) {
    console.log(
      (c.owner ?? "?").slice(0, 5).padEnd(6),
      (c.lcc ?? "(none)").padEnd(width),
      "->",
      c.next.padEnd(24),
      c.title.slice(0, 40),
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these.");
  } else {
    let n = 0;
    for (const c of changes) {
      await pool.query(`UPDATE books SET lcc = $1 WHERE id = $2`, [c.next, c.id]);
      n++;
    }
    console.log(`\nUpdated ${n} books.`);
  }
} finally {
  await pool.end();
}
