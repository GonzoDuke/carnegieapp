import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

// drizzle-kit runs outside Next.js, so it doesn't auto-load .env.local.
// @next/env ships with Next and uses the same loader Next does.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // `db:push` is declarative: it makes the database match this schema file.
  // A table it finds in the DB but not in the file reads as "deleted" and
  // gets DROPped. Carnegie shares its database with Frick (the companion
  // shelflist app), whose tables live in the `shelflist` Postgres schema —
  // so without these filters, a routine push here would propose dropping
  // Frick's tables, and Frick's push would propose dropping Carnegie's.
  //
  // schemaFilter is the real boundary (Carnegie only ever sees `public`);
  // tablesFilter is belt-and-braces in case something of Frick's ever
  // lands in `public` by accident. strict forces a confirmation prompt
  // before any statement runs.
  schemaFilter: ["public"],
  tablesFilter: [
    "users",
    "batches",
    "books",
    "batch_uploads",
    "login_attempts",
    "vision_usage",
  ],
  strict: true,
});
