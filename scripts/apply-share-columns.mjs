// One-off, idempotent migration for the public share feature.
//
// Adds the columns the share surface needs:
//   users.share_token        (text, UNIQUE)  — bearer token for /share/<token>
//   users.shared_at          (timestamptz)   — when sharing was enabled
//   batch_uploads.box_label  (text)          — which box a photo shows
//
// We apply these here rather than via `drizzle-kit push` because push asks an
// interactive TTY question before adding the UNIQUE constraint, which can't be
// answered in a non-interactive shell. All statements are additive and guarded
// with IF NOT EXISTS / a pg_constraint check, so re-running is safe.
//
// Run: node scripts/apply-share-columns.mjs

import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

// @next/env is CommonJS; in raw Node ESM the named export isn't exposed, so
// pull loadEnvConfig off the default export.
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (looked in .env.local).");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  console.log("→ users.share_token");
  await sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "share_token" text`;

  console.log("→ users.shared_at");
  await sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shared_at" timestamp with time zone`;

  console.log("→ batch_uploads.box_label");
  await sql`ALTER TABLE "batch_uploads" ADD COLUMN IF NOT EXISTS "box_label" text`;

  console.log("→ users_share_token_unique constraint");
  const rows = await sql`
    SELECT 1 FROM pg_constraint WHERE conname = 'users_share_token_unique'
  `;
  if (rows.length === 0) {
    // NULLs don't collide under a UNIQUE constraint, so existing users with a
    // null share_token are fine.
    await sql`ALTER TABLE "users" ADD CONSTRAINT "users_share_token_unique" UNIQUE ("share_token")`;
    console.log("  added");
  } else {
    console.log("  already present");
  }

  console.log("✓ done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
