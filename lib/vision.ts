import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import sharp from "sharp";

// Sonnet 4.6 is the default — good accuracy/cost balance for clean spines.
// Opus is the escalation target: when a Sonnet pass returns any book under
// LOW_CONFIDENCE, the route re-runs the same image on Opus to claw back
// accuracy on the ambiguous shots. Haiku exists if you want to go cheaper.
export const SONNET_MODEL = "claude-sonnet-4-6";
export const OPUS_MODEL = "claude-opus-4-7";

// Cached system prompt — prompt caching gives ~70% savings on repeat input
// tokens, which matters because this prompt is verbose and every shelf photo
// re-uses it.
const SYSTEM_PROMPT = `You are extracting books from a photograph of physical books, typically a bookshelf, a stack, or several books laid out together.

For every distinct physical book in the image, return a JSON entry with:

- "title": string. The book's title as printed on the spine. Preserve punctuation, capitalization, and intentional cover styling (asterisk-censored profanity stays as asterisks). If a subtitle is also printed, include it after a colon. If the cover prominently shows the author's name as a separate line, the author goes in "author" — do NOT concatenate the author into the title. If a single letter is partially obscured, prefer the most likely letter from real-world title context (a partially-obscured "Free" is far more likely than "Far"); but never invent words you cannot see at least the first and last letter of. Library shelf stickers go in "spine_classification", not here.

- "author": string or null. The author(s) as printed on the SAME spine as the title. The author belongs to ONLY the spine that physically carries it — never carry an author from a neighboring book. If the spine you are reading does not show an author (some books print only the title; some printings put the author on the cover but not the spine), return null. Multiple authors join with " / ". Library shelf stickers go in "spine_classification", not here.

- "visible_isbn": string or null. Only fill this when you can clearly read the digits of an ISBN or decode a printed barcode. Otherwise null.

- "spine_classification": string or null. Verbatim text from a library shelving sticker if one is visible (e.g. "PR6045.O72 H37 1999", "813.54 STE", "FIC TOL"). Otherwise null. Never put this text in the title or author fields.

- "confidence": number between 0.0 and 1.0. Use this rubric — pick the LOWEST confidence whose description fits:
  - 0.95+: every word of title and author is clearly legible.
  - 0.80: title clearly legible; author partial (initial only, or last name partly obscured).
  - 0.60: title legible but you are guessing one word or letter; author unknown or unreadable.
  - 0.40: best-guess at the dominant word in the title; everything else inferred from book size, color, or context.
  - 0.20: nearly illegible; only a partial word read.

Multi-volume series rule: when a single spine shows BOTH a series title and a volume identifier and the volume's own title (e.g. "The New Cambridge Modern History" + "Vol II" + "The Reformation 1520–1559"), capture the FULL combined string as one title. Do not split into multiple shorter entries — that's one physical book, one entry.

Each physical book on the shelf gets exactly one entry. Two physical copies of the same book are two entries.

Skip:
- Decorative objects, knick-knacks, picture frames, plants.
- Non-book media: vinyl records, CD / DVD / Blu-ray cases, video games, magazines, three-ring binders. These often shelve alongside books and have spine-like geometry — but never catalog them as books.
- Books where the spine is so obscured you cannot read more than a single letter or partial word.

If the image contains only non-book media (e.g. a wall of vinyl records, a DVD rack), return an empty books array.

Return your output by calling the report_books tool. Each detected book becomes one entry in the books array.

Examples (for reference; do not include these in your output):

Spine shows "SOPHOCLES" stacked above "THE OEDIPUS CYCLE":
  { "title": "The Oedipus Cycle", "author": "Sophocles", "visible_isbn": null, "spine_classification": null, "confidence": 0.95 }

Spine shows "THE NEW CAMBRIDGE MODERN HISTORY" / "VOL II" / "THE REFORMATION 1520-1559" stacked vertically (one book, three lines):
  { "title": "The New Cambridge Modern History, Vol II: The Reformation 1520-1559", "author": null, "visible_isbn": null, "spine_classification": null, "confidence": 0.80 }

Spine partially obscured: you can read "We Are Not Fr_e" with one letter unclear:
  { "title": "We Are Not Free", "author": "Traci Chee", "visible_isbn": null, "spine_classification": null, "confidence": 0.60 }`;

export type VisionBook = {
  title: string;
  author: string | null;
  visible_isbn: string | null;
  spine_classification: string | null;
  confidence: number;
};

export type VisionExtraction = {
  books: VisionBook[];
  raw: unknown;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// Tool schema is the structured-output contract. Anthropic validates the
// model's output against this before returning, so the days of
// parseJsonLoose / regex-extracting JSON from free-text are over — the
// SDK either gives us a valid input object or throws.
const REPORT_BOOKS_TOOL: Tool = {
  name: "report_books",
  description:
    "Report every distinct book detected on the shelf, one entry per physical book.",
  input_schema: {
    type: "object",
    properties: {
      books: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Book title as printed on the spine.",
            },
            author: {
              type: ["string", "null"],
              description: "Author(s), or null if not on the same spine.",
            },
            visible_isbn: {
              type: ["string", "null"],
              description: "ISBN if clearly readable on spine; otherwise null.",
            },
            spine_classification: {
              type: ["string", "null"],
              description: "Verbatim library shelf-sticker text, or null.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Confidence per the rubric in the system prompt.",
            },
          },
          required: ["title", "confidence"],
        },
      },
    },
    required: ["books"],
  },
};

export async function extractBooksFromImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  model: string = SONNET_MODEL,
): Promise<VisionExtraction> {
  const response = await client().messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [REPORT_BOOKS_TOOL],
    tool_choice: { type: "tool", name: "report_books" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Identify every book you can see and call the report_books tool.",
          },
        ],
      },
    ],
  });

  // tool_choice forces the model to call our tool; the input is the
  // schema-validated payload.
  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  const input = (toolUse?.input ?? {}) as { books?: unknown[] };
  const books = Array.isArray(input.books)
    ? (input.books as unknown[]).flatMap(normalizeVisionBook)
    : [];

  return {
    books,
    raw: { input },
    model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

// ─── Two-pass escalation: detect → crop → per-spine extract ──────────────
//
// When the bulk extractBooksFromImage pass returns low-confidence books,
// the route can re-process the same image as a detect-then-read pipeline.
// Each detected spine becomes its own cropped image fed to a single-book
// extractor, which gives the model 5–10× the effective resolution per
// spine and isolates each book from its neighbors (which fixes the
// cross-attribution failure mode where authors leak between adjacent
// spines).

export type SpineBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectionResult = {
  boxes: SpineBox[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

export type SingleSpineResult = {
  book: VisionBook | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

const DETECT_SPINES_TOOL: Tool = {
  name: "report_spine_boxes",
  description:
    "Report the bounding box of every book spine visible in the image, as normalized fractions of the image dimensions.",
  input_schema: {
    type: "object",
    properties: {
      boxes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            x: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Left edge as a fraction of image width (0 = left edge, 1 = right edge).",
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Top edge as a fraction of image height (0 = top, 1 = bottom).",
            },
            width: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Width as a fraction of image width.",
            },
            height: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Height as a fraction of image height.",
            },
          },
          required: ["x", "y", "width", "height"],
        },
      },
    },
    required: ["boxes"],
  },
};

const DETECT_PROMPT = `You are locating book spines in a photograph. Return the bounding box of every distinct book spine you can identify — even partially visible ones.

Do NOT read titles. Do NOT extract metadata. Do NOT skip ambiguous spines. Just locate every vertical strip that is a book spine.

Coordinates are **normalized fractions of the image dimensions**: x and y are 0 at top-left and 1 at the opposite edges; width and height are likewise 0–1 fractions. A spine that occupies the middle 5% of the image horizontally and the full vertical extent has x≈0.475, y=0, width≈0.05, height=1.0.

Boxes should be tight around the spine itself — exclude shelf wood and neighboring books. A typical bookshelf photo has 5–30 spines.`;

export async function detectSpineBoxes(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  model: string = SONNET_MODEL,
): Promise<DetectionResult> {
  const response = await client().messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: DETECT_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [DETECT_SPINES_TOOL],
    tool_choice: { type: "tool", name: "report_spine_boxes" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Locate every spine and call the report_spine_boxes tool.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  const input = (toolUse?.input ?? {}) as { boxes?: unknown[] };
  const boxes = Array.isArray(input.boxes)
    ? input.boxes.filter(isValidBox)
    : [];

  return {
    boxes,
    model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

function isValidBox(b: unknown): b is SpineBox {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

// Crop a region from the source image, then upscale so the long edge hits
// the target. Upscaling buys the per-spine model more pixels to work with
// — a 5% slice of the original becomes ~1024px tall after crop+scale,
// which is the whole point of the two-pass design.
//
// `box` is in normalized 0–1 fractions of the image dimensions (that's
// what detectSpineBoxes returns; Claude Vision's internal coordinate
// system doesn't reliably match the original image's pixel dimensions,
// so we ask for normalized coords and scale here).
export async function cropImage(
  imageBuffer: Buffer,
  box: SpineBox,
  targetLongEdge: number = 1024,
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const imgWidth = meta.width ?? 0;
  const imgHeight = meta.height ?? 0;

  // Scale normalized coords to pixels, then clamp to image bounds so a
  // slightly-off model box doesn't crash sharp.
  const pxX = Math.round(box.x * imgWidth);
  const pxY = Math.round(box.y * imgHeight);
  const pxW = Math.round(box.width * imgWidth);
  const pxH = Math.round(box.height * imgHeight);

  const left = Math.max(0, Math.min(imgWidth - 1, pxX));
  const top = Math.max(0, Math.min(imgHeight - 1, pxY));
  const width = Math.max(1, Math.min(imgWidth - left, pxW));
  const height = Math.max(1, Math.min(imgHeight - top, pxH));

  let pipeline = sharp(imageBuffer).extract({ left, top, width, height });
  const longEdge = Math.max(width, height);
  if (longEdge < targetLongEdge) {
    const scale = targetLongEdge / longEdge;
    pipeline = pipeline.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      fit: "fill",
    });
  }
  return pipeline.jpeg({ quality: 85 }).toBuffer();
}

const REPORT_ONE_BOOK_TOOL: Tool = {
  name: "report_one_book",
  description:
    "Report the single book whose spine fills this cropped image. Same field rules as the bulk-extraction tool.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      author: { type: ["string", "null"] },
      visible_isbn: { type: ["string", "null"] },
      spine_classification: { type: ["string", "null"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["title", "confidence"],
  },
};

const ONE_SPINE_PROMPT = `This image is a close-up crop of a single book spine. Read it carefully and report what you see by calling the report_one_book tool.

Field rules (same as the bulk-extraction pass):
- "title": the title as printed on the spine. Preserve punctuation, capitalization, and intentional cover styling (asterisks for censored profanity stay). Include subtitle after a colon if printed.
- "author": author(s) on THIS spine only. Multiple authors join with " / ". null if not visible on this crop.
- "visible_isbn": digits if clearly readable on the spine. Otherwise null.
- "spine_classification": library shelf-sticker text verbatim. Otherwise null.
- "confidence" rubric (pick the LOWEST that fits):
  - 0.95+: every word of title and author clearly legible.
  - 0.80: title clear; author partial (initial only or last name partly obscured).
  - 0.60: title legible but you are guessing one word or letter; author unknown or unreadable.
  - 0.40: best-guess at the dominant word; everything else inferred.
  - 0.20: nearly illegible; only a partial word read.

If the crop does not contain a real book spine (cropping artifact, decorative object, mostly empty), return title="" and confidence=0 — the caller will drop empty entries.`;

export async function extractOneSpineFromImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  model: string = OPUS_MODEL,
): Promise<SingleSpineResult> {
  const response = await client().messages.create({
    model,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: ONE_SPINE_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [REPORT_ONE_BOOK_TOOL],
    tool_choice: { type: "tool", name: "report_one_book" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Read this spine and report via report_one_book.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  const input = (toolUse?.input ?? null) as Record<string, unknown> | null;
  const books = input ? normalizeVisionBook(input) : [];

  return {
    book: books[0] ?? null,
    model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

function normalizeVisionBook(raw: unknown): VisionBook[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return [];
  const author = typeof r.author === "string" && r.author.trim() ? r.author.trim() : null;
  const isbn = typeof r.visible_isbn === "string" && r.visible_isbn.trim() ? r.visible_isbn.trim() : null;
  const spine =
    typeof r.spine_classification === "string" && r.spine_classification.trim()
      ? r.spine_classification.trim()
      : null;
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.min(1, Math.max(0, r.confidence))
    : 0;
  return [{ title, author, visible_isbn: isbn, spine_classification: spine, confidence }];
}
