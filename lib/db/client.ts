import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let cached: DB | null = null;

export function getDb(): DB {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision a Neon database (Vercel Marketplace or neon.tech) and add it to .env.local.",
    );
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}

export { schema };
