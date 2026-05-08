import Anthropic from "@anthropic-ai/sdk";

// Sonnet 4.6 is a good balance of vision accuracy and cost for spine reading.
// To switch to a more capable model, swap to "claude-opus-4-7"; for cheaper,
// "claude-haiku-4-5-20251001".
const MODEL = "claude-sonnet-4-6";

// Cached system prompt — prompt caching gives ~70% savings on repeat input
// tokens, which matters because this prompt is verbose and every shelf photo
// re-uses it.
const SYSTEM_PROMPT = `You are extracting books from a photograph of physical books, typically a bookshelf, a stack, or several books laid out together.

For every distinct book you can identify in the image, return a JSON entry with:
- "title": string. The book's title as it appears on the spine. Clean up obvious OCR artifacts (broken letters, partial words). If a subtitle is visible, include it after a colon.
- "author": string or null. The author(s) as printed on the spine. Use null if no author is visible. For multiple authors, join with " / ".
- "visible_isbn": string or null. Only fill this if you can clearly read an ISBN number or scan a barcode in the image. Otherwise null.
- "confidence": number between 0.0 and 1.0. Your confidence that this is a real, distinct book and that the title is correct.

Skip:
- Decorative objects, knick-knacks, picture frames.
- Books where you cannot read enough of the spine to even guess at the title.
- Duplicates of the same book within one image.

Output ONLY a single JSON object. No prose, no markdown fences, no commentary.

Schema:
{
  "books": [
    { "title": "string", "author": "string|null", "visible_isbn": "string|null", "confidence": 0.0 }
  ]
}`;

export type VisionBook = {
  title: string;
  author: string | null;
  visible_isbn: string | null;
  confidence: number;
};

export type VisionExtraction = {
  books: VisionBook[];
  raw: unknown;
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
): Promise<VisionExtraction> {
  const response = await client().messages.create({
    model: MODEL,
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
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.min(1, Math.max(0, r.confidence))
    : 0;
  return [{ title, author, visible_isbn: isbn, confidence }];
}
