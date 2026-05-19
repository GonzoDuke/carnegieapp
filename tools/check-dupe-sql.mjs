// Print the actual SQL Drizzle emits for the home-page duplicate
// query, then run it against prod. Helps decide whether the bug is
// in query translation vs. somewhere downstream.

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Minimal mirror of the schema columns the home-page query touches.
// Keeping this file standalone avoids the TS-import dance.
const batches = pgTable("batches", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

const books = pgTable("books", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  isbn13: text("isbn_13"),
  isbn10: text("isbn_10"),
});

const env = {};
for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[line.slice(0, i).trim()] = v;
}

const db = drizzle(neon(env.DATABASE_URL));
const userId = "b699a68a-83eb-4395-a40f-fbcf7e938b15";

const q = db
  .select({
    canonical: drizzleSql`COALESCE(${books.isbn13}, ${books.isbn10})`,
  })
  .from(books)
  .innerJoin(batches, eq(books.batchId, batches.id))
  .where(
    and(
      eq(books.ownerId, userId),
      drizzleSql`(${books.isbn13} IS NOT NULL OR ${books.isbn10} IS NOT NULL)`,
      isNull(batches.deletedAt),
    ),
  )
  .groupBy(drizzleSql`COALESCE(${books.isbn13}, ${books.isbn10})`)
  .having(drizzleSql`COUNT(*) > 1`);

const compiled = q.toSQL();
console.log("SQL:");
console.log(compiled.sql);
console.log("\nPARAMS:");
console.log(compiled.params);
const rows = await q;
console.log("\nROWS RETURNED:", rows.length);
if (rows.length > 0) console.log(rows);
