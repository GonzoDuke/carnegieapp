// Read-only: compare two batches for overlap, and optionally merge them
// into one worksheet.
//
//   node tools/compare-batches.mjs "Ref Pulls" "Second Round Cuts"
//   node tools/compare-batches.mjs "Cart 1" "Cart 2" --merge merged.xlsx
//
// Batches are matched by name fragment (case-insensitive) or id prefix.
//
// WHY NOT THE /duplicates PAGE: that matches on ISBN alone. In this
// reference collection only 15-33% of books have an ISBN — they're older
// and predate them — while ~100% have a call number, which is now read off
// the spine sticker. Matching on ISBN would miss most real duplicates here.
//
// Match tiers, strongest first. Each pair reports which tier caught it so
// you can judge the weak ones rather than trusting a flat "duplicate" flag:
//
//   isbn   same ISBN. Unambiguous.
//   lcc    identical call number including year. Same edition, same shelf
//          position — as close to certain as this collection gets.
//   work   same call number ignoring a trailing year. Same work, different
//          printing. Usually what you want to know about for weeding.
//   title  normalised title plus first author surname. The fallback for
//          books with neither identifier; most likely to throw a false
//          positive, so it's reported separately.

import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import ExcelJS from "exceljs";

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

const args = process.argv.slice(2);
const mergeIdx = args.indexOf("--merge");
const mergeTo = mergeIdx >= 0 ? args[mergeIdx + 1] : null;
const names = args.filter((a, i) => {
  if (a === "--merge") return false;
  if (mergeIdx >= 0 && i === mergeIdx + 1) return false;
  return true;
});

if (names.length !== 2) {
  console.error(
    'Usage: node tools/compare-batches.mjs "<batch A>" "<batch B>" [--merge out.xlsx]',
  );
  process.exit(1);
}

const dbUrl = loadEnv("DATABASE_URL");
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const pool = new Pool({ connectionString: dbUrl });

// ---- normalisers --------------------------------------------------------

// Strip everything that varies in how a call number is written — spacing,
// the dot before a cutter, case — so "PR6045 .O72 H37" and "PR6045.O72 H37"
// compare equal.
function lccKey(lcc) {
  if (!lcc) return null;
  const k = lcc.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k || null;
}

// Same, minus a trailing 4-digit year, so two printings of one work collide.
function workKey(lcc) {
  if (!lcc) return null;
  const k = lcc.toUpperCase().trim().replace(/\s*\b(1[89]\d{2}|20\d{2})\b\s*$/, "");
  const out = k.replace(/[^A-Z0-9]/g, "");
  return out || null;
}

const STOP = /^(a|an|the)\s+/i;
function titleKey(title, authors) {
  if (!title) return null;
  const t = title
    .replace(STOP, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (t.length < 6) return null;
  const surname = (authors?.[0] ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .pop();
  return `${t}|${(surname ?? "").toLowerCase()}`;
}

// ---- load ---------------------------------------------------------------

async function findBatch(needle) {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, u.name AS owner
       FROM batches b JOIN users u ON u.id = b.owner_id
      WHERE b.deleted_at IS NULL
        AND (b.name ILIKE $1 OR b.id::text LIKE $2)
      ORDER BY b.name`,
    [`%${needle}%`, `${needle}%`],
  );
  if (rows.length === 0) throw new Error(`No batch matching "${needle}"`);
  if (rows.length > 1) {
    throw new Error(
      `"${needle}" matches ${rows.length} batches: ${rows.map((r) => r.name).join(", ")}`,
    );
  }
  return rows[0];
}

async function loadBooks(batchId) {
  const { rows } = await pool.query(
    `SELECT id, title, authors, isbn_13, isbn_10, lcc, publisher, pub_date, status
       FROM books
      WHERE batch_id = $1 AND status <> 'rejected'
      ORDER BY lcc NULLS LAST, title`,
    [batchId],
  );
  return rows.map((r) => ({
    ...r,
    isbn: r.isbn_13 || r.isbn_10 || null,
    lccKey: lccKey(r.lcc),
    workKey: workKey(r.lcc),
    titleKey: titleKey(r.title, r.authors),
  }));
}

const [batchA, batchB] = await Promise.all(names.map(findBatch));
if (batchA.id === batchB.id) {
  console.error("Both names matched the same batch.");
  await pool.end();
  process.exit(1);
}
const [booksA, booksB] = await Promise.all([
  loadBooks(batchA.id),
  loadBooks(batchB.id),
]);

// ---- match --------------------------------------------------------------

const TIERS = [
  ["isbn", (b) => b.isbn],
  ["lcc", (b) => b.lccKey],
  ["work", (b) => b.workKey],
  ["title", (b) => b.titleKey],
];

const pairedB = new Set();
const matches = [];
const onlyA = [];

for (const a of booksA) {
  let hit = null;
  for (const [tier, keyOf] of TIERS) {
    const key = keyOf(a);
    if (!key) continue;
    const candidate = booksB.find((b) => !pairedB.has(b.id) && keyOf(b) === key);
    if (candidate) {
      hit = { tier, a, b: candidate };
      break;
    }
  }
  if (hit) {
    pairedB.add(hit.b.id);
    matches.push(hit);
  } else {
    onlyA.push(a);
  }
}
const onlyB = booksB.filter((b) => !pairedB.has(b.id));

// ---- report -------------------------------------------------------------

const byTier = {};
for (const m of matches) byTier[m.tier] = (byTier[m.tier] ?? 0) + 1;

console.log(`A: ${batchA.name} (${batchA.owner}) — ${booksA.length} books`);
console.log(`B: ${batchB.name} (${batchB.owner}) — ${booksB.length} books`);
console.log();
console.log(`in both:    ${matches.length}`);
for (const [tier] of TIERS) {
  if (byTier[tier]) console.log(`  by ${tier.padEnd(6)} ${byTier[tier]}`);
}
console.log(`only in A:  ${onlyA.length}`);
console.log(`only in B:  ${onlyB.length}`);
console.log(`merged:     ${matches.length + onlyA.length + onlyB.length} distinct`);

if (matches.length) {
  console.log("\nOVERLAP");
  console.log("tier   call number            title");
  console.log("-".repeat(78));
  for (const m of matches.slice(0, 40)) {
    console.log(
      `${m.tier.padEnd(6)} ${(m.a.lcc ?? "—").slice(0, 22).padEnd(22)} ${m.a.title.slice(0, 46)}`,
    );
    if (m.tier === "title" || m.tier === "work") {
      console.log(`       ${" ".repeat(22)} B: ${m.b.title.slice(0, 46)}`);
    }
  }
  if (matches.length > 40) console.log(`… ${matches.length - 40} more`);
}

// ---- merge --------------------------------------------------------------

if (mergeTo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carnegie";
  const ws = wb.addWorksheet("Merged", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const cols = [
    { header: "In", width: 12 },
    { header: "Matched by", width: 11 },
    { header: "Call number", width: 24 },
    { header: "Title", width: 48 },
    { header: "Author", width: 26 },
    { header: "Publisher", width: 24 },
    { header: "Date", width: 10 },
    { header: "ISBN", width: 16 },
    { header: "Decision", width: 14 },
    { header: "Note", width: 36 },
  ];
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));

  const rowsOut = [
    ...matches.map((m) => ({
      inWhich: "both",
      tier: m.tier,
      book: m.a,
    })),
    ...onlyA.map((b) => ({ inWhich: batchA.name, tier: "", book: b })),
    ...onlyB.map((b) => ({ inWhich: batchB.name, tier: "", book: b })),
  ];
  // Shelf order — the whole point of merging is to walk it as one range.
  rowsOut.sort((x, y) =>
    (x.book.lcc ?? "￿").localeCompare(y.book.lcc ?? "￿"),
  );

  for (const r of rowsOut) {
    ws.addRow([
      r.inWhich,
      r.tier,
      r.book.lcc ?? "",
      r.book.title ?? "",
      (r.book.authors ?? []).join(" / "),
      r.book.publisher ?? "",
      r.book.pub_date ?? "",
      r.book.isbn ?? "",
      "",
      "",
    ]);
  }

  ws.getRow(1).font = { bold: true };
  ws.autoFilter = `A1:J1`;
  const last = rowsOut.length + 1;
  for (let r = 2; r <= last; r++) {
    ws.getCell(r, 9).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Keep,Discard,Undecided"'],
      showErrorMessage: true,
      errorTitle: "Pick from the list",
      error: "Use one of: Keep, Discard, Undecided.",
    };
    // Tint the rows that appear in both, so overlap is visible at a glance
    // rather than something you have to filter for.
    if (ws.getCell(r, 1).value === "both") {
      ws.getRow(r).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFDF0D5" },
      };
    }
    ws.getRow(r).alignment = { vertical: "top", wrapText: false };
  }

  const about = wb.addWorksheet("About");
  about.columns = [{ width: 16 }, { width: 92 }];
  about.addRows([
    ["Batch A", `${batchA.name} — ${booksA.length} books`],
    ["Batch B", `${batchB.name} — ${booksB.length} books`],
    ["In both", String(matches.length)],
    ["Only in A", String(onlyA.length)],
    ["Only in B", String(onlyB.length)],
    ["Distinct", String(rowsOut.length)],
    [],
    [
      "Matched by",
      "isbn = same ISBN. lcc = identical call number. work = same call number ignoring year (different printing). title = normalised title + author surname; check these, they are the weakest.",
    ],
    [
      "Note",
      "Read-only export. Nothing here writes back to Carnegie.",
    ],
  ]);
  about.getColumn(1).font = { bold: true };

  await wb.xlsx.writeFile(mergeTo);
  console.log(`\nmerged worksheet -> ${mergeTo}`);
}

await pool.end();
