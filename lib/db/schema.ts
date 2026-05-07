import {
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
  notes: text("notes"),
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
  confidence: real("confidence"),
  rawVision: jsonb("raw_vision"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
