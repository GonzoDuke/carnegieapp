import Anthropic from "@anthropic-ai/sdk";

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

- "author": string or null. The author(s) as printed on the spine or cover. Multiple authors join with " / ". Use null when no author is visible. Library shelf stickers go in "spine_classification", not here.

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
- Books where the spine is so obscured you cannot read more than a single letter or partial word.

Output ONLY a single JSON object. No prose, no markdown fences, no commentary.

Schema:
{
  "books": [
    { "title": "string", "author": "string|null", "visible_isbn": "string|null", "spine_classification": "string|null", "confidence": 0.0 }
  ]
}

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
            text: "Extract every book you can identify in this image. Return JSON only.",
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const parsed = parseJsonLoose(text);
  const books = Array.isArray(parsed?.books)
    ? (parsed.books as unknown[]).flatMap(normalizeVisionBook)
    : [];

  return {
    books,
    raw: { text, parsed },
    model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

// Models occasionally wrap JSON in ```json fences or add a sentence before/after.
// Try a strict parse first, then fall back to extracting the first {...} block.
function parseJsonLoose(text: string): { books?: unknown[] } | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
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
