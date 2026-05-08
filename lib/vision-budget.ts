import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

const DEFAULT_LIMIT = 200;

export function dailyLimit(): number {
  const raw = process.env.VISION_DAILY_LIMIT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LIMIT;
}

function todayKey(): string {
  // UTC date as YYYY-MM-DD; matches the `date` column type.
  return new Date().toISOString().slice(0, 10);
}

export type BudgetStatus = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
};

export async function getBudget(): Promise<BudgetStatus> {
  const db = getDb();
  const day = todayKey();
  const [row] = await db
    .select()
    .from(schema.visionUsage)
    .where(eq(schema.visionUsage.day, day))
    .limit(1);
  const used = row?.count ?? 0;
  const limit = dailyLimit();
  return {
    date: day,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}

// Atomic increment via UPSERT — concurrent vision requests can't double-spend
// the budget. Returns the post-increment status.
export async function incrementUsage(): Promise<BudgetStatus> {
  const db = getDb();
  const day = todayKey();
  const [row] = await db
    .insert(schema.visionUsage)
    .values({ day, count: 1 })
    .onConflictDoUpdate({
      target: schema.visionUsage.day,
      set: { count: sql`${schema.visionUsage.count} + 1` },
    })
    .returning();
  const used = row?.count ?? 1;
  const limit = dailyLimit();
  return {
    date: day,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}
