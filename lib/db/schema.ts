import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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

// Per-user accounts. Authentication is by passcode only (no emails);
// passcode_hash stores `salt_hex:hash_hex` from node:crypto's scrypt.
// Each user's library is fully isolated via owner_id on every owned table.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  passcodeHash: text("passcode_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    location: text("location"),
    notes: text("notes"),
    // Set the last time this batch was downloaded as CSV. Used to flag batches
    // already pushed to LibraryThing so the user doesn't accidentally re-import.
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("batches_owner_idx").on(t.ownerId)],
);

// owner_id is denormalized onto books (source of truth is batches.owner_id).
// The trade-off: every per-book route can filter on books.owner_id directly
// instead of joining through batches. With 14 routes touching books, the
// query simplification is worth the redundancy.
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    // 1-based left-to-right index within the source photo. Set by the
    // vision route from the model's "position" field so the review
    // queue can render books in the same order they appear on the
    // shelf. Null on manual entries and recrops (they don't have a
    // canonical position on the original photo).
    position: integer("position"),
    rawVision: jsonb("raw_vision"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("books_owner_idx").on(t.ownerId)],
);

// One row per vision-photo upload. Lets the review UI show the user the
// original shelf photo so they can spot books vision missed without
// standing in front of the shelf. Blob is deleted when the batch is
// exported (see export.csv route); the row is dropped at the same time
// via cascade on batch delete.
export const batchUploads = pgTable(
  "batch_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    // Vercel Blob URL (publicly fetchable but unguessable). For a two-user
    // app this is the right privacy tier; would need signed URLs to share
    // beyond that.
    blobUrl: text("blob_url").notNull(),
    // Path-within-blob, needed for del() at export time.
    blobPath: text("blob_path").notNull(),
    model: text("model"),
    escalated: boolean("escalated").notNull().default(false),
    detectedCount: integer("detected_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("batch_uploads_batch_idx").on(t.batchId),
    index("batch_uploads_owner_idx").on(t.ownerId),
  ],
);

// Per-IP failed-login log. Inserted on every failed passcode attempt.
// The login route counts entries in a recent window before doing scrypt
// work — over the threshold, return 429 instead. Rows expire on read
// (DELETE WHERE attempted_at < now() - interval '1 hour') so the table
// stays bounded without a cron job.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // X-Forwarded-For client IP. Truncated to 64 chars for sanity.
    ip: text("ip").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("login_attempts_ip_idx").on(t.ip, t.attemptedAt)],
);

// Per-user, per-day vision-API call counter. Composite PK so a single user
// can't blow through another user's daily quota.
export const visionUsage = pgTable(
  "vision_usage",
  {
    day: date("day").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.ownerId] })],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type BatchUpload = typeof batchUploads.$inferSelect;
export type NewBatchUpload = typeof batchUploads.$inferInsert;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;
export type VisionUsage = typeof visionUsage.$inferSelect;
