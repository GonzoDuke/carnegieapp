import {
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const sourceEnum = pgEnum("source", ["vision", "barcode", "manual"]);
export const statusEnum = pgEnum("status", [
  "pending_review",
  "confirmed",
  "rejected",
]);

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  location: text("location"),
  notes: text("notes"),
  // Set the last time this batch was downloaded as CSV. Used to flag batches
  // already pushed to LibraryThing so the user doesn't accidentally re-import.
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  source: sourceEnum("source").notNull(),
  status: statusEnum("status").notNull().default("pending_review"),
  isbn13: text("isbn_13"),
  isbn10: text("isbn_10"),
  title: text("title").notNull(),
  authors: text("authors").array().notNull().default([]),
  publisher: text("publisher"),
  pubDate: text("pub_date"),
  tags: text("tags").array().notNull().default([]),
  collections: text("collections").array().notNull().default([]),
  comments: text("comments"),
  // Cover image URL captured from a successful lookup (Google Books / ISBNdb /
  // Open Library). Persisted so the UI doesn't have to guess at fetch time.
  coverUrl: text("cover_url"),
  // Library of Congress Classification call number when Open Library has it.
  // Used for shelving-by-LoC and surfaced in the LibraryThing CSV.
  lcc: text("lcc"),
  // Book synopsis / description from the lookup provider (Google Books'
  // "description", ISBNdb's "synopsys"). Distinct from per-book user
  // comments — shows up in the expanded book row and in the CSV Comments.
  description: text("description"),
  confidence: real("confidence"),
  rawVision: jsonb("raw_vision"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Tracks Claude vision API calls per UTC day so the cost cap can fail-fast.
export const visionUsage = pgTable("vision_usage", {
  day: date("day").primaryKey(),
  count: integer("count").notNull().default(0),
});

export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type VisionUsage = typeof visionUsage.$inferSelect;
