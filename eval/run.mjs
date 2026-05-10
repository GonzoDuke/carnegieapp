// Vision eval harness. See eval/README.md for setup.
//
// Imports lib/vision.ts directly — avoids the per-user daily budget
// (incrementUsage) the production route enforces, since the harness is
// allowed to spend on prompt iteration. Uses Node's strip-types loader
// to read the TS file without a build step (Node 22+).
//
// Run from the repo root:
//   npm run eval:vision
//   npm run eval:vision -- --strict
//   npm run eval:vision -- --photo=<basename>
//   npm run eval:vision -- --escalate          # also run Opus pass
//
// (lib/vision.ts has no relative imports, so Node's strip-types loader
// resolves it cleanly. The lookup chain has extensionless `.ts` imports
// throughout that the loader chokes on without `tsx`, so end-to-end
// metadata testing is intentionally out of this scaffold; add `tsx` and
// a `--with-lookup` flag if you want it later.)
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { extname, join, basename } from "node:path";
import { extractBooksFromImage, OPUS_MODEL } from "../lib/vision.ts";

const ROOT = process.cwd();
const PHOTOS_DIR = join(ROOT, "eval", "photos");
const TRUTH_DIR = join(ROOT, "eval", "truth");
const BASELINE_PATH = join(ROOT, "eval", "baseline.json");

const args = parseArgs(process.argv.slice(2));
const escalateFlag = args.escalate ?? false;
const strictFlag = args.strict ?? false;
const photoFilter = args.photo ?? null;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) {
      out[a.slice(2)] = true;
    } else {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    }
  }
  return out;
}

function loadEnvIfMissing() {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    /* no .env.local */
  }
}

function pickMediaType(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return null;
}

// Lowercase, drop non-alphanumeric except spaces, collapse whitespace.
// Used for fuzzy title and author comparison so trivial casing/punct
// differences between truth files and model output don't fail matches.
function normalize(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A truth book matches an extracted book if (a) the normalized titles
// share a 4-char-or-longer token, AND (b) the normalized authors share a
// 4-char-or-longer token (when both have authors). Loose enough for
// "Pale Fire" / "Pale fire: a poem" but tight enough to avoid spurious
// matches between two different books with similar one-word titles.
function bookMatch(a, b) {
  const aTitle = normalize(a.title);
  const bTitle = normalize(b.title);
  if (!aTitle || !bTitle) return false;
  const titleTokens = new Set(aTitle.split(" ").filter((t) => t.length >= 4));
  const titleHit = bTitle.split(" ").some((t) => t.length >= 4 && titleTokens.has(t));
  if (!titleHit) return false;
  const aAuth = a.author ? normalize(a.author) : "";
  const bAuth = b.author ? normalize(b.author) : "";
  if (!aAuth || !bAuth) return true;
  const authTokens = new Set(aAuth.split(" ").filter((t) => t.length >= 4));
  return bAuth.split(" ").some((t) => t.length >= 4 && authTokens.has(t));
}

function listPhotos() {
  if (!existsSync(PHOTOS_DIR)) return [];
  return readdirSync(PHOTOS_DIR)
    .filter((f) => pickMediaType(f) !== null)
    .filter((f) => !photoFilter || basename(f, extname(f)) === photoFilter)
    .sort();
}

async function runOnePhoto(photoFile) {
  const photoPath = join(PHOTOS_DIR, photoFile);
  const truthPath = join(TRUTH_DIR, basename(photoFile, extname(photoFile)) + ".json");
  const mediaType = pickMediaType(photoFile);
  if (!mediaType) throw new Error(`Unsupported file extension: ${photoFile}`);
  const truth = existsSync(truthPath)
    ? JSON.parse(readFileSync(truthPath, "utf8"))
    : null;
  if (!truth) {
    return { photo: photoFile, status: "no-truth" };
  }

  const buf = readFileSync(photoPath);
  const base64 = buf.toString("base64");

  let extraction = await extractBooksFromImage(base64, mediaType);
  let escalated = false;
  if (escalateFlag) {
    const lowest = extraction.books.length
      ? Math.min(...extraction.books.map((b) => b.confidence))
      : 1;
    if (lowest < 0.7) {
      try {
        const opus = await extractBooksFromImage(base64, mediaType, OPUS_MODEL);
        if (opus.books.length > 0) {
          extraction = opus;
          escalated = true;
        }
      } catch {
        /* fall back to Sonnet */
      }
    }
  }

  const truthBooks = truth.books ?? [];
  const extracted = extraction.books.map((b) => ({
    title: b.title,
    author: b.author,
    isbn: b.visible_isbn,
    confidence: b.confidence,
  }));

  // Greedy 1:1 matching from truth → extracted. Each truth book consumes
  // at most one extracted book; an extracted book that doesn't pair to
  // any truth book counts as `extra`.
  const matchedExtracted = new Set();
  const missed = [];
  for (const t of truthBooks) {
    const idx = extracted.findIndex(
      (e, i) => !matchedExtracted.has(i) && bookMatch(t, e),
    );
    if (idx === -1) missed.push(t.title);
    else matchedExtracted.add(idx);
  }
  const extra = extracted
    .map((e, i) => (matchedExtracted.has(i) ? null : e.title))
    .filter(Boolean);

  const truePositives = matchedExtracted.size;
  const precision = extracted.length > 0 ? truePositives / extracted.length : 0;
  const recall = truthBooks.length > 0 ? truePositives / truthBooks.length : 0;
  const meanConfidence = extracted.length
    ? extracted.reduce((s, b) => s + (b.confidence ?? 0), 0) / extracted.length
    : 0;

  return {
    photo: photoFile,
    status: "scored",
    truth_count: truthBooks.length,
    extracted_count: extracted.length,
    matched: truePositives,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    mean_confidence: Number(meanConfidence.toFixed(3)),
    model: extraction.model,
    escalated,
    extra,
    missed,
  };
}

function compareBaseline(current) {
  if (!existsSync(BASELINE_PATH)) return null;
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const byPhoto = new Map(baseline.results.map((r) => [r.photo, r]));
  const regressions = [];
  for (const r of current) {
    if (r.status !== "scored") continue;
    const prev = byPhoto.get(r.photo);
    if (!prev || prev.status !== "scored") continue;
    const recallDelta = r.recall - prev.recall;
    if (recallDelta < -0.05) {
      regressions.push({
        photo: r.photo,
        recall_was: prev.recall,
        recall_now: r.recall,
        delta: Number(recallDelta.toFixed(3)),
      });
    }
  }
  return regressions;
}

loadEnvIfMissing();

const photos = listPhotos();
if (photos.length === 0) {
  console.log("No photos in eval/photos/. See eval/README.md for setup.");
  process.exit(0);
}

console.log(`Running ${photos.length} photo(s)...\n`);

const results = [];
for (const p of photos) {
  process.stdout.write(`  ${p}  ...  `);
  try {
    const r = await runOnePhoto(p);
    results.push(r);
    if (r.status === "no-truth") {
      console.log("no truth file, skipping");
    } else {
      console.log(
        `P=${r.precision} R=${r.recall} conf=${r.mean_confidence} (${r.matched}/${r.truth_count}, +${r.extra.length} extra)${r.escalated ? " [opus]" : ""}`,
      );
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    results.push({ photo: p, status: "failed", error: err.message });
  }
}

const scored = results.filter((r) => r.status === "scored");
if (scored.length > 0) {
  const avgP = scored.reduce((s, r) => s + r.precision, 0) / scored.length;
  const avgR = scored.reduce((s, r) => s + r.recall, 0) / scored.length;
  const avgC = scored.reduce((s, r) => s + r.mean_confidence, 0) / scored.length;
  console.log(
    `\nSummary: P=${avgP.toFixed(3)}  R=${avgR.toFixed(3)}  conf=${avgC.toFixed(3)}  (${scored.length} photos)`,
  );
}

const regressions = compareBaseline(results);
if (regressions && regressions.length > 0) {
  console.log("\nRegressions vs. baseline (recall dropped >5%):");
  for (const r of regressions) {
    console.log(`  ${r.photo}: ${r.recall_was} → ${r.recall_now} (${r.delta})`);
  }
  if (strictFlag) {
    process.exit(1);
  }
}

writeFileSync(
  BASELINE_PATH,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
);
console.log(`\nBaseline written to eval/baseline.json`);
