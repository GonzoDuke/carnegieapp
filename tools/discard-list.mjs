// Build one deduplicated list from several batches — the "what are we
// actually discarding" sheet.
//
//   node tools/discard-list.mjs "Ref Pulls" "Second Round Cuts" \
//     --minus "Felicia - Ref Keeps" --out discard-list.xlsx
//
// Read-only. Batches are matched by name fragment or id prefix.
//
// HOW IT GROUPS
//
// Every book gets up to four keys: ISBN, exact call number, call number
// ignoring a trailing year, and normalised title + first author's surname.
// Books sharing ANY key land in the same cluster, and clustering is
// transitive — if A and B share an ISBN and B and C share a title, all
// three are one work.
//
// Using every key rather than one matters here. Title+author is the only
// key with full coverage (100% of titles, ~99.7% of authors, against 15-33%
// for ISBN), so it's the broad net — but it alone finds 34 overlaps between
// Ref Pulls and Second Round Cuts, where the full set finds 41. The extra 7
// are records whose titles differ (a subtitle present in one, absent in the
// other) but whose ISBN or call number agrees. Neither key is sufficient
// alone.
//
// Clusters that were built ONLY from a title match are flagged, because
// that's the key that can produce a false positive.

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
    /* none */
  }
  return null;
}

// ---- args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const include = [];
const minus = [];
let out = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--minus") minus.push(argv[++i]);
  else if (argv[i] === "--out") out = argv[++i];
  else include.push(argv[i]);
}
if (include.length === 0) {
  console.error(
    'Usage: node tools/discard-list.mjs "<batch>" ["<batch>" …] [--minus "<batch>"] [--out file.xlsx]',
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: loadEnv("DATABASE_URL") });

// ---- keys ---------------------------------------------------------------
const STOP = /^(a|an|the)\s+/i;

function isbnKey(b) {
  const v = b.isbn_13 || b.isbn_10;
  return v ? `i:${v}` : null;
}
function lccKey(b) {
  if (!b.lcc) return null;
  const k = b.lcc.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k ? `l:${k}` : null;
}
function workKey(b) {
  if (!b.lcc) return null;
  const k = b.lcc
    .toUpperCase()
    .trim()
    .replace(/\s*\b(1[89]\d{2}|20\d{2})\b\s*$/, "")
    .replace(/[^A-Z0-9]/g, "");
  return k.length >= 4 ? `w:${k}` : null;
}
function titleKey(b) {
  const t = (b.title || "")
    .replace(STOP, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (t.length < 6) return null;
  const surname = ((b.authors && b.authors[0]) || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .pop();
  return `t:${t}|${(surname || "").toLowerCase()}`;
}
const KEYS = [
  ["isbn", isbnKey],
  ["lcc", lccKey],
  ["work", workKey],
  ["title", titleKey],
];

// ---- load ---------------------------------------------------------------
async function resolve(needle) {
  const { rows } = await pool.query(
    `SELECT b.id, b.name FROM batches b
      WHERE b.deleted_at IS NULL AND (b.name ILIKE $1 OR b.id::text LIKE $2)`,
    [`%${needle}%`, `${needle}%`],
  );
  if (rows.length === 0) throw new Error(`No batch matching "${needle}"`);
  if (rows.length > 1)
    throw new Error(
      `"${needle}" matches ${rows.length}: ${rows.map((r) => r.name).join(", ")}`,
    );
  return rows[0];
}

const incBatches = [];
for (const n of include) incBatches.push(await resolve(n));
const minusBatches = [];
for (const n of minus) minusBatches.push(await resolve(n));

async function books(ids) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT bk.id, bk.title, bk.authors, bk.isbn_13, bk.isbn_10, bk.lcc,
            bk.publisher, bk.pub_date, bk.status, b.name AS batch
       FROM books bk JOIN batches b ON b.id = bk.batch_id
      WHERE bk.batch_id = ANY($1) AND bk.status <> 'rejected'`,
    [ids],
  );
  return rows;
}

const pulled = await books(incBatches.map((b) => b.id));
const excluded = await books(minusBatches.map((b) => b.id));

// ---- group: ACROSS batches only ------------------------------------------
//
// Two records merge only when they come from different batches. Within one
// batch every record stays its own row, because two records in the same
// batch are usually two physical books — the shelf photo for Ref Pulls has
// The Penguin Historical Atlas of Ancient Egypt at positions 11 AND 12 with
// the same call number, which is two copies standing side by side, not one
// book counted twice. Collapsing those would hide a book you have to pull.
//
// Across batches it's the opposite: a title on both Ref Pulls and Second
// Round Cuts is almost always the same item moving through your workflow.
//
// Matching is greedy and one-to-one, so if a batch holds two copies and the
// next holds one, exactly one pair merges and the spare stays its own row.
function keysOf(b) {
  const out = [];
  for (const [name, keyOf] of KEYS) {
    const k = keyOf(b);
    if (k) out.push([name, k]);
  }
  return out;
}
for (const b of pulled) b._keys = keysOf(b);

const groups = [];
for (const batch of incBatches) {
  for (const book of pulled.filter((b) => b.batch === batch.name)) {
    // Only groups that don't already hold a record from this batch are
    // eligible — that's what keeps same-batch copies apart.
    let target = null;
    let via = null;
    for (const g of groups) {
      if (g.batches.has(batch.name)) continue;
      const hit = book._keys.find(([, k]) =>
        g.records.some((r) => r._keys.some(([, rk]) => rk === k)),
      );
      if (hit) {
        target = g;
        via = hit[0];
        break;
      }
    }
    if (target) {
      target.records.push(book);
      target.batches.add(batch.name);
      target.via.add(via);
    } else {
      groups.push({
        records: [book],
        batches: new Set([batch.name]),
        via: new Set(),
      });
    }
  }
}

// ---- exclusions ---------------------------------------------------------
const excludeKeys = new Set();
for (const b of excluded) {
  for (const [, keyOf] of KEYS) {
    const k = keyOf(b);
    if (k) excludeKeys.add(k);
  }
}
function isExcluded(records) {
  return records.some((b) => b._keys.some(([, k]) => excludeKeys.has(k)));
}

// ---- build rows ---------------------------------------------------------
const kept = [];
let droppedByExclusion = 0;

for (const g of groups) {
  if (isExcluded(g.records)) {
    droppedByExclusion++;
    continue;
  }
  // Best record wins the display: prefer one with a call number, then an
  // ISBN, then the longest title (usually the one that kept its subtitle).
  const best = [...g.records].sort((x, y) => {
    const s = (b) => (b.lcc ? 4 : 0) + (b.isbn_13 || b.isbn_10 ? 2 : 0);
    return s(y) - s(x) || (y.title || "").length - (x.title || "").length;
  })[0];

  kept.push({
    best,
    records: g.records,
    batches: [...g.batches].sort(),
    via: [...g.via],
    titleOnly: g.records.length > 1 && g.via.size === 1 && g.via.has("title"),
    pending: g.records.some((b) => b.status === "pending_review"),
  });
}

// Number the rows that share an identifier, so it's obvious at the shelf
// that you're pulling more than one item rather than looking at a mistake.
// In practice most of these are multi-volume sets filed under a single call
// number — "Encyclopedia of the Enlightenment" volumes I and II both sit at
// B802 .F53 2001 — which is exactly why these must not be merged.
const byWork = new Map();
for (const k of kept) {
  const wk =
    (k.best.isbn_13 || k.best.isbn_10 || null) ??
    workKey(k.best) ??
    titleKey(k.best);
  if (!wk) continue;
  if (!byWork.has(wk)) byWork.set(wk, []);
  byWork.get(wk).push(k);
}
for (const rows of byWork.values()) {
  if (rows.length < 2) continue;
  rows.forEach((r, i) => {
    r.copyLabel = `${i + 1} of ${rows.length}`;
  });
}

kept.sort((a, b) => (a.best.lcc ?? "￿").localeCompare(b.best.lcc ?? "￿"));

// ---- report -------------------------------------------------------------
console.log(`including: ${incBatches.map((b) => b.name).join(", ")}`);
if (minusBatches.length)
  console.log(`minus:     ${minusBatches.map((b) => b.name).join(", ")}`);
console.log();
const merged = kept.filter((k) => k.batches.length > 1).length;
const multiCopy = kept.filter((k) => k.copyLabel).length;

console.log(`records in included batches:  ${pulled.length}`);
console.log(`merged across batches:        ${pulled.length - groups.length}`);
if (minusBatches.length)
  console.log(`removed by exclusion:         ${droppedByExclusion}`);
console.log(`FINAL LIST (physical items):  ${kept.length}`);
console.log();
console.log(`on more than one list:        ${merged}`);
console.log(`second/third copies kept:     ${multiCopy}  (numbered "1 of 2" etc.)`);
const weak = kept.filter((k) => k.titleOnly);
console.log(`merged on title alone:        ${weak.length}  (worth eyeballing)`);
const stillPending = kept.filter((k) => k.pending).length;
if (stillPending) console.log(`still pending review:         ${stillPending}`);

if (weak.length) {
  console.log("\nGROUPED ON TITLE ALONE — check these");
  for (const k of weak.slice(0, 15)) {
    console.log(`  ${(k.best.lcc ?? "—").padEnd(22)} ${k.best.title.slice(0, 48)}`);
  }
  if (weak.length > 15) console.log(`  … ${weak.length - 15} more`);
}

// ---- write --------------------------------------------------------------
if (out) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carnegie";
  const ws = wb.addWorksheet("Discard list", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Call number", width: 24 },
    { header: "Title", width: 50 },
    { header: "Author", width: 26 },
    { header: "Publisher", width: 24 },
    { header: "Date", width: 10 },
    { header: "ISBN", width: 16 },
    { header: "Same call #", width: 12 },
    { header: "From", width: 32 },
    { header: "Check", width: 9 },
    { header: "Decision", width: 14 },
    { header: "Note", width: 36 },
  ];
  for (const k of kept) {
    ws.addRow([
      k.best.lcc ?? "",
      k.best.title ?? "",
      (k.best.authors ?? []).join(" / "),
      k.best.publisher ?? "",
      k.best.pub_date ?? "",
      k.best.isbn_13 || k.best.isbn_10 || "",
      k.copyLabel ?? "",
      k.batches.join(" + "),
      k.titleOnly ? "title only" : "",
      "",
      "",
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = "A1:K1";
  for (let r = 2; r <= kept.length + 1; r++) {
    ws.getCell(r, 10).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Keep,Discard,Undecided"'],
      showErrorMessage: true,
      errorTitle: "Pick from the list",
      error: "Use one of: Keep, Discard, Undecided.",
    };
    ws.getRow(r).alignment = { vertical: "top", wrapText: false };
    if (ws.getCell(r, 9).value === "title only") {
      ws.getRow(r).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFDECEA" },
      };
    }
  }

  const about = wb.addWorksheet("About");
  about.columns = [{ width: 20 }, { width: 92 }];
  about.addRows([
    ["Included", incBatches.map((b) => b.name).join(", ")],
    ["Excluded", minusBatches.map((b) => b.name).join(", ") || "(none)"],
    ["Records in", String(pulled.length)],
    ["Merged across lists", String(pulled.length - groups.length)],
    ["Removed by exclusion", String(droppedByExclusion)],
    ["Final list", String(kept.length)],
    [],
    [
      "One row =",
      "One physical book to pull off the shelf.",
    ],
    [
      "Merging",
      "Records merge ONLY across batches, never within one. A title on two lists is the same item moving through the workflow; two records in the same batch are two copies on the shelf, so they stay separate rows.",
    ],
    [
      "Same call # column",
      '"1 of 2" means two items in this list share that call number. Usually volumes of a set (Volume I and Volume II are filed together), sometimes a genuine second copy. Either way, expect to find that many on the shelf.',
    ],
    [
      "Check column",
      '"title only" means the merge rested purely on a title match — the key that can produce a false positive. Those rows are tinted; give them a look.',
    ],
    ["Note", "Read-only export. Nothing here writes back to Carnegie."],
  ]);
  about.getColumn(1).font = { bold: true };

  await wb.xlsx.writeFile(out);
  console.log(`\n-> ${out}`);
}

await pool.end();
