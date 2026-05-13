import Link from "next/link";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { stripIsbn, normalizeIsbn } from "@/lib/lookup/isbn";
import TopBar from "@/components/TopBar";
import FilterDropdown from "@/components/FilterDropdown";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookCover } from "@/components/BookCover";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending_review", label: "Pending" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "vision", label: "Vision" },
  { value: "barcode", label: "Barcode" },
  { value: "manual", label: "Manual" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Newest" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "confidence", label: "Confidence" },
];

type SearchParams = Promise<{
  q?: string;
  status?: string;
  source?: string;
  batch?: string;
  tag?: string;
  sort?: string;
  page?: string;
}>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "all";
  const source = sp.source ?? "all";
  const batch = sp.batch ?? "all";
  const tag = sp.tag ?? "all";
  const sort = sp.sort ?? "recent";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const filters = { q, status, source, batch, tag, sort };

  const db = getDb();

  // Build the WHERE clause from the active filters. Owner filter is always
  // first — every query must scope to the current user.
  const whereParts: SQL[] = [
    eq(schema.books.ownerId, userId),
    // Hide books that belong to soft-deleted batches. Every query
    // below inner-joins schema.batches, so adding this predicate
    // once on the shared whereParts covers all of them.
    sql`${schema.batches.deletedAt} IS NULL`,
  ];

  if (q) {
    const stripped = stripIsbn(q);
    const normalized = normalizeIsbn(q);
    const isbnCandidates = [stripped, normalized.isbn13, normalized.isbn10]
      .filter((s): s is string => !!s && s.length >= 10);
    const wildcard = `%${q}%`;
    whereParts.push(
      or(
        ilike(schema.books.title, wildcard),
        sql`EXISTS (SELECT 1 FROM unnest(${schema.books.authors}) AS a WHERE a ILIKE ${wildcard})`,
        ...(isbnCandidates.length > 0
          ? [
              sql`${schema.books.isbn13} = ANY(${isbnCandidates})`,
              sql`${schema.books.isbn10} = ANY(${isbnCandidates})`,
            ]
          : []),
      )!,
    );
  }

  if (status !== "all") {
    whereParts.push(
      eq(
        schema.books.status,
        status as "pending_review" | "confirmed" | "rejected",
      ),
    );
  }
  if (source !== "all") {
    whereParts.push(
      eq(schema.books.source, source as "vision" | "barcode" | "manual"),
    );
  }
  if (batch !== "all") {
    whereParts.push(eq(schema.books.batchId, batch));
  }
  if (tag !== "all") {
    whereParts.push(sql`${tag} = ANY(${schema.books.tags})`);
  }

  const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;

  // ORDER BY varies by sort. For "confidence", null confidences (manual /
  // barcode books) get sorted last via COALESCE; vision rows surface first.
  const orderBy: SQL[] = (() => {
    switch (sort) {
      case "title":
        return [asc(schema.books.title)];
      case "author":
        return [asc(sql`${schema.books.authors}[1]`)];
      case "confidence":
        return [asc(sql`COALESCE(${schema.books.confidence}, 1)`)];
      default:
        return [desc(schema.books.createdAt)];
    }
  })();

  const offset = (page - 1) * PAGE_SIZE;

  const [results, [{ n: totalCount }], allTags, allBatches] = await Promise.all([
    db
      .select({
        id: schema.books.id,
        batchId: schema.books.batchId,
        batchName: schema.batches.name,
        batchLocation: schema.batches.location,
        title: schema.books.title,
        authors: schema.books.authors,
        isbn13: schema.books.isbn13,
        isbn10: schema.books.isbn10,
        coverUrl: schema.books.coverUrl,
        status: schema.books.status,
      })
      .from(schema.books)
      .innerJoin(
        schema.batches,
        eq(schema.books.batchId, schema.batches.id),
      )
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ n: count() })
      .from(schema.books)
      .innerJoin(
        schema.batches,
        eq(schema.books.batchId, schema.batches.id),
      )
      .where(whereClause),
    db.execute<{ tag: string }>(
      sql`SELECT DISTINCT tag FROM books
          JOIN batches ON batches.id = books.batch_id,
          unnest(tags) AS tag
          WHERE books.owner_id = ${userId}
            AND batches.deleted_at IS NULL
          ORDER BY tag`,
    ),
    db
      .select({ id: schema.batches.id, name: schema.batches.name })
      .from(schema.batches)
      .where(
        and(
          eq(schema.batches.ownerId, userId),
          sql`${schema.batches.deletedAt} IS NULL`,
        ),
      )
      .orderBy(schema.batches.name),
  ]);

  const tagOptions = [
    { value: "all", label: "All tags" },
    ...allTags.rows.map((r) => ({ value: r.tag, label: r.tag })),
  ];
  const batchOptions = [
    { value: "all", label: "All batches" },
    ...allBatches.map((b) => ({ value: b.id, label: b.name })),
  ];

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters =
    q !== "" ||
    status !== "all" ||
    source !== "all" ||
    batch !== "all" ||
    tag !== "all";

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          ← Home
        </Link>

        <header className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {q ? "Search" : "Browse"}
            </h1>
            <span className="text-muted-foreground text-xs">
              {totalCount.toLocaleString()}{" "}
              {totalCount === 1 ? "book" : "books"}
              {hasFilters ? " match" : ""}
            </span>
          </div>
          <form
            action="/search"
            method="GET"
            role="search"
            className="flex items-center gap-2"
          >
            {/* Preserve other active filters when submitting a new query */}
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            {source !== "all" && <input type="hidden" name="source" value={source} />}
            {batch !== "all" && <input type="hidden" name="batch" value={batch} />}
            {tag !== "all" && <input type="hidden" name="tag" value={tag} />}
            {sort !== "recent" && <input type="hidden" name="sort" value={sort} />}
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Title, author, or ISBN — leave blank to browse everything"
              className="flex-1"
            />
            <Button type="submit" size="sm">
              <Search className="size-4" />
              Search
            </Button>
          </form>
        </header>

        {/* Filter / sort row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y py-3 text-xs">
          <FilterPills
            label="Status"
            current={status}
            paramName="status"
            options={STATUS_OPTIONS}
            filters={filters}
          />
          <FilterPills
            label="Source"
            current={source}
            paramName="source"
            options={SOURCE_OPTIONS}
            filters={filters}
          />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium uppercase tracking-wider">
              Batch
            </span>
            <FilterDropdown
              name="batch"
              value={batch}
              options={batchOptions}
              preserve={preserveExcept(filters, "batch", "page")}
              ariaLabel="Filter by batch"
            />
          </div>
          {tagOptions.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium uppercase tracking-wider">
                Tag
              </span>
              <FilterDropdown
                name="tag"
                value={tag}
                options={tagOptions}
                preserve={preserveExcept(filters, "tag", "page")}
                ariaLabel="Filter by tag"
              />
            </div>
          )}
          <FilterPills
            label="Sort"
            current={sort}
            paramName="sort"
            options={SORT_OPTIONS}
            filters={filters}
          />
          {hasFilters && (
            <Link
              href="/search"
              className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
            >
              Clear all
            </Link>
          )}
        </div>

        {/* Results */}
        {results.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              {q
                ? `No matches for "${q}".`
                : hasFilters
                  ? "No books match these filters."
                  : "No books cataloged yet. Add some from a batch."}
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {results.map((book) => (
              <li key={book.id}>
                <Link
                  href={`/batches/${book.batchId}#book-${book.id}`}
                  className="block"
                >
                  <Card className="hover:border-primary/40 overflow-hidden transition-all hover:shadow-sm">
                    <CardContent className="flex items-start gap-3 p-3">
                      <BookCover
                        coverUrl={book.coverUrl}
                        isbn13={book.isbn13}
                        isbn10={book.isbn10}
                        title={book.title}
                        size="sm"
                        className="ring-accent/20 mt-0.5 ring-1"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium">{book.title}</p>
                          <Badge variant={statusBadgeVariant(book.status)}>
                            {book.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {book.authors.length > 0
                            ? book.authors.join(" / ")
                            : "Unknown author"}
                          {book.isbn13 && ` · ${book.isbn13}`}
                          {book.isbn10 && !book.isbn13 && ` · ${book.isbn10}`}
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          In <span className="text-foreground">{book.batchName}</span>
                          {book.batchLocation ? ` · ${book.batchLocation}` : ""}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="text-muted-foreground flex items-center justify-between text-xs">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <PaginationLink
                page={page - 1}
                disabled={page <= 1}
                filters={filters}
                label={
                  <>
                    <ChevronLeft className="size-3" />
                    Prev
                  </>
                }
              />
              <PaginationLink
                page={page + 1}
                disabled={page >= totalPages}
                filters={filters}
                label={
                  <>
                    Next
                    <ChevronRight className="size-3" />
                  </>
                }
              />
            </div>
          </nav>
        )}
      </main>
    </>
  );
}

type FilterState = {
  q: string;
  status: string;
  source: string;
  batch: string;
  tag: string;
  sort: string;
};

function FilterPills({
  label,
  current,
  paramName,
  options,
  filters,
}: {
  label: string;
  current: string;
  paramName: keyof FilterState;
  options: { value: string; label: string }[];
  filters: FilterState;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground font-medium uppercase tracking-wider">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((o) => {
          const active = current === o.value;
          const href = buildHref({ ...filters, [paramName]: o.value, page: "1" });
          return (
            <Link
              key={o.value}
              href={href}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                active
                  ? "border-primary/40 bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted text-foreground/80"
              }`}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PaginationLink({
  page,
  disabled,
  filters,
  label,
}: {
  page: number;
  disabled: boolean;
  filters: FilterState;
  label: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="text-muted-foreground/50 inline-flex h-7 cursor-not-allowed items-center gap-1 rounded border px-2.5 text-[11px]">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={buildHref({ ...filters, page: String(page) })}
      className="hover:bg-muted inline-flex h-7 items-center gap-1 rounded border px-2.5 text-[11px] transition-colors"
    >
      {label}
    </Link>
  );
}

function buildHref(state: FilterState & { page?: string }): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.status && state.status !== "all") params.set("status", state.status);
  if (state.source && state.source !== "all") params.set("source", state.source);
  if (state.batch && state.batch !== "all") params.set("batch", state.batch);
  if (state.tag && state.tag !== "all") params.set("tag", state.tag);
  if (state.sort && state.sort !== "recent") params.set("sort", state.sort);
  if (state.page && state.page !== "1") params.set("page", state.page);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function preserveExcept(
  filters: FilterState,
  ...drop: (keyof FilterState | "page")[]
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys: (keyof FilterState)[] = [
    "q",
    "status",
    "source",
    "batch",
    "tag",
    "sort",
  ];
  for (const k of keys) {
    if (drop.includes(k)) continue;
    const v = filters[k];
    if (v && v !== "all") out[k] = v;
  }
  return out;
}

function statusBadgeVariant(
  status: "pending_review" | "confirmed" | "rejected",
): "default" | "secondary" | "outline" {
  switch (status) {
    case "confirmed":
      return "default";
    case "rejected":
      return "outline";
    default:
      return "secondary";
  }
}
