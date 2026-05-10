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
const repeatCount = Math.max(1, parseInt(args.repeat ?? "1", 10) || 1);

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

// Letter-only sequence (no spaces, no digits, no punctuation). Used by
// the subsequence match so a censored title ("Sh*t is F*cked") matches
// its uncensored truth ("Shit is Fucked") — the censored letters are
// missing, so a strict equality fails, but the censored letters form
// a subsequence of the uncensored ones in order.
function letterOnly(s) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

// True iff every character of `needle` appears in `hay` in order
// (consecutive or not). O(n+m). Caller should call with the shorter
// string as needle so a long truth title isn't rejected for a short
// model output.
function isSubsequence(needle, hay) {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

// Tokenize, drop short articles. 4+ char threshold catches "oedipus" /
// "cycle" but skips "the" / "of" / "a".
function tokensFour(normalized) {
  return new Set(normalized.split(" ").filter((t) => t.length >= 4));
}

// Title compatibility — three tiers, any of which is sufficient:
//   1. Substring containment of the normalized titles. Catches
//      "X" in "Chuck Klosterman X" and "The Oedipus Cycle" in
//      "Sophocles: The Oedipus Cycle".
//   2. 4+ char token overlap (the original heuristic — still the
//      cleanest signal when both titles have meaningful words).
//   3. Letter-only subsequence — handles censored variants where some
//      letters are replaced by `*` ("Sh*t is F*cked Up" vs "Shit is
//      Fucked Up").
function titleCompatible(a, b) {
  const t = normalize(a);
  const e = normalize(b);
  if (!t || !e) return false;

  // 1. Substring (with a space-padded wrap so "X" only matches at word
  // boundaries — otherwise "X" in "Xenophon" would spuriously match).
  if (` ${e} `.includes(` ${t} `) || ` ${t} `.includes(` ${e} `)) return true;

  // 2. 4+ char token overlap — require ≥50% of the smaller side's
  // 4+ char tokens to overlap. The previous version returned true on
  // any single token overlap, which mis-paired "Constructing the
  // American Past..." with "Sources of the American Social Tradition"
  // on a lone "american". Pale Fire / Pale Fire: A Poem still match
  // (2 of 2), but unrelated titles sharing one stop-token-ish word
  // don't.
  const tTokens = tokensFour(t);
  const eTokens = tokensFour(e);
  if (tTokens.size > 0 && eTokens.size > 0) {
    const minSize = Math.min(tTokens.size, eTokens.size);
    let overlap = 0;
    for (const tok of tTokens) if (eTokens.has(tok)) overlap++;
    if (overlap / minSize >= 0.5) return true;
  }

  // 3. Letter-only subsequence in either direction.
  const tLetters = letterOnly(a);
  const eLetters = letterOnly(b);
  if (tLetters && eLetters) {
    const [shorter, longer] =
      tLetters.length <= eLetters.length ? [tLetters, eLetters] : [eLetters, tLetters];
    // Require the shorter side to be at least 6 chars to avoid spurious
    // subsequence hits from very short normalizations.
    if (shorter.length >= 6 && isSubsequence(shorter, longer)) return true;
  }

  return false;
}

// Author compatibility — looser than title matching because the model
// frequently puts the author in the title field ("Sophocles: The
// Oedipus Cycle") and leaves the author field null or partial. Matches
// when:
//   - either side has no author (model+truth disagree on field
//     placement, but the title carried it — caller already verified
//     title compatibility),
//   - 4+ char token overlap on the author fields, OR
//   - the truth author appears as a substring of the model's title (or
//     vice versa) — catches the "author-in-title" case directly.
function authorCompatible(truthAuthor, extractedAuthor, truthTitle, extractedTitle) {
  const tA = truthAuthor ? normalize(truthAuthor) : "";
  const eA = extractedAuthor ? normalize(extractedAuthor) : "";
  if (!tA || !eA) return true;
  const tTokens = tokensFour(tA);
  for (const tok of eA.split(" ")) {
    if (tok.length >= 4 && tTokens.has(tok)) return true;
  }
  // Author-in-title fallback.
  const eT = ` ${normalize(extractedTitle)} `;
  for (const tok of tA.split(" ")) {
    if (tok.length >= 4 && eT.includes(` ${tok} `)) return true;
  }
  const tT = ` ${normalize(truthTitle)} `;
  for (const tok of eA.split(" ")) {
    if (tok.length >= 4 && tT.includes(` ${tok} `)) return true;
  }
  return false;
}

function bookMatch(a, b) {
  if (!titleCompatible(a.title, b.title)) return false;
  return authorCompatible(a.author, b.author, a.title, b.title);
}

function listPhotos() {
  if (!existsSync(PHOTOS_DIR)) return [];
  return readdirSync(PHOTOS_DIR)
    .filter((f) => pickMediaType(f) !== null)
    .filter((f) => !photoFilter || basename(f, extname(f)) === photoFilter)
    .sort();
}

// Anthropic enforces a 5 MiB cap on the **base64-encoded** image, which
// is 4/3 the raw byte size — so the raw-bytes ceiling is ~3.75 MiB. The
// production PhotoCapture component compresses on the client; the eval
// harness reads photos straight off disk, so anything bigger needs to
// be re-saved at lower quality or smaller dimensions before the harness
// can score it. We skip with a clear message instead of crashing.
const HARNESS_MAX_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4); // 3,932,160

// Score one model output against the truth. Pure function — no API calls.
function scoreTrial(extraction, truthBooks) {
  const extracted = extraction.books.map((b) => ({
    title: b.title,
    author: b.author,
    isbn: b.visible_isbn,
    confidence: b.confidence,
  }));

  // Greedy 1:1 matching from truth → extracted.
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
  const extraDetail = extracted
    .map((e, i) => (matchedExtracted.has(i) ? null : e))
    .filter(Boolean);

  const truePositives = matchedExtracted.size;
  // Empty-truth photos test "does the model correctly NOT extract from
  // this image" (e.g., a shelf of vinyl that isn't books). They're not
  // book-extraction quality tests, so they get vacuous-true recall and
  // a precision based on whether the model returned anything at all.
  const emptyTruth = truthBooks.length === 0;
  const precision = emptyTruth
    ? extracted.length === 0
      ? 1
      : 0
    : extracted.length > 0
      ? truePositives / extracted.length
      : 0;
  const recall = emptyTruth ? 1 : truePositives / truthBooks.length;
  const meanConfidence = extracted.length
    ? extracted.reduce((s, b) => s + (b.confidence ?? 0), 0) / extracted.length
    : 0;

  return {
    extracted_count: extracted.length,
    matched: truePositives,
    precision,
    recall,
    mean_confidence: meanConfidence,
    extra,
    missed,
    extra_detail: extraDetail,
  };
}

// Run vision once (with optional confidence-gated Opus escalation).
async function runOneTrial(base64, mediaType) {
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
  return { extraction, escalated };
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
  if (buf.length > HARNESS_MAX_BYTES) {
    return {
      photo: photoFile,
      status: "oversized",
      bytes: buf.length,
      limit: HARNESS_MAX_BYTES,
    };
  }
  const base64 = buf.toString("base64");
  const truthBooks = truth.books ?? [];

  // N trials per photo. Sequential rather than parallel so we don't
  // bunch up against Anthropic rate limits or trip the per-user vision
  // budget. The trade-off: a 12-photo --repeat=3 run takes ~3x longer
  // than a single-trial run.
  const trials = [];
  for (let i = 0; i < repeatCount; i++) {
    const { extraction, escalated } = await runOneTrial(base64, mediaType);
    const score = scoreTrial(extraction, truthBooks);
    trials.push({ ...score, model: extraction.model, escalated });
  }

  const avg = (k) => trials.reduce((s, t) => s + t[k], 0) / trials.length;
  const min = (k) => Math.min(...trials.map((t) => t[k]));
  const max = (k) => Math.max(...trials.map((t) => t[k]));

  // For the headline extra/missed lists, take the first trial's
  // (most recent) — but include all per-trial detail so the user can
  // see run-to-run variance when N>1.
  const headline = trials[0];

  return {
    photo: photoFile,
    status: "scored",
    trials: trials.length,
    truth_count: truthBooks.length,
    extracted_count: headline.extracted_count,
    matched: headline.matched,
    precision: Number(avg("precision").toFixed(3)),
    recall: Number(avg("recall").toFixed(3)),
    mean_confidence: Number(avg("mean_confidence").toFixed(3)),
    precision_min: Number(min("precision").toFixed(3)),
    precision_max: Number(max("precision").toFixed(3)),
    recall_min: Number(min("recall").toFixed(3)),
    recall_max: Number(max("recall").toFixed(3)),
    model: headline.model,
    escalated: trials.some((t) => t.escalated),
    extra: headline.extra,
    missed: headline.missed,
    extra_detail: headline.extra_detail,
    // When N>1, dump per-trial extras/missed so variance is visible.
    per_trial: trials.length > 1
      ? trials.map((t, i) => ({
          trial: i + 1,
          precision: Number(t.precision.toFixed(3)),
          recall: Number(t.recall.toFixed(3)),
          extra: t.extra,
          missed: t.missed,
        }))
      : undefined,
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
    } else if (r.status === "oversized") {
      console.log(
        `oversized (${(r.bytes / 1024 / 1024).toFixed(1)} MB > ${r.limit / 1024 / 1024} MB), skipping. Re-save the photo smaller and re-run.`,
      );
    } else {
      const range =
        r.trials > 1
          ? ` (avg of ${r.trials}, R range ${r.recall_min}-${r.recall_max})`
          : "";
      console.log(
        `P=${r.precision} R=${r.recall} conf=${r.mean_confidence}${range}${r.escalated ? " [opus]" : ""}`,
      );
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    results.push({ photo: p, status: "failed", error: err.message });
  }
}

const scored = results.filter((r) => r.status === "scored");
// Empty-truth photos (model-knows-not-to-extract tests) live separately
// from the book-extraction summary so a 34-album vinyl photo doesn't
// drag the headline P/R numbers down.
const bookPhotos = scored.filter((r) => r.truth_count > 0);
const phantomPhotos = scored.filter((r) => r.truth_count === 0);
if (bookPhotos.length > 0) {
  const avgP = bookPhotos.reduce((s, r) => s + r.precision, 0) / bookPhotos.length;
  const avgR = bookPhotos.reduce((s, r) => s + r.recall, 0) / bookPhotos.length;
  const avgC = bookPhotos.reduce((s, r) => s + r.mean_confidence, 0) / bookPhotos.length;
  console.log(
    `\nSummary: P=${avgP.toFixed(3)}  R=${avgR.toFixed(3)}  conf=${avgC.toFixed(3)}  (${bookPhotos.length} book photos)`,
  );
}
if (phantomPhotos.length > 0) {
  const phantomTotal = phantomPhotos.reduce(
    (s, r) => s + (r.extracted_count ?? 0),
    0,
  );
  console.log(
    `Phantom test: ${phantomTotal} false extractions across ${phantomPhotos.length} non-book photo(s).`,
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
