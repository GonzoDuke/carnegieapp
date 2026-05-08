import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { lookupByIsbn } from "@/lib/lookup";

const PayloadSchema = z.object({
  isbn: z.string().trim().min(1).max(100),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const outcome = await lookupByIsbn(parsed.data.isbn);
  if (!outcome.isbn.isbn13) {
    return NextResponse.json(
      {
        error: "Could not parse a valid ISBN",
        isbn: outcome.isbn,
        attempts: outcome.attempts,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(outcome);
}
