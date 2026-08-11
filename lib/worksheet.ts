import ExcelJS from "exceljs";
import type { Book } from "@/lib/db/schema";

// A working spreadsheet, as opposed to the LibraryThing CSV.
//
// The CSV is a machine format: its column names are LibraryThing's, its
// column order suits an importer, and it crams location, the publisher's
// blurb and your own notes into one Comments cell separated by newlines —
// which is what makes rows tall enough to be unreadable in Excel.
//
// This is the other thing: a sheet you sit and work in. Reading order,
// one fact per column, room to record a decision, and the bits of Excel
// that make a few hundred rows tractable — a frozen header, AutoFilter,
// and a real dropdown so three people spell "Discard" the same way.
//
// Both exports exist side by side. Nothing here changes the CSV.

export const DECISIONS = ["Keep", "Discard", "Undecided"] as const;

export type WorksheetRow = {
  book: Book;
  batchName: string;
  batchLocation: string | null;
  boxLabel: string | null;
};

type Column = {
  header: string;
  width: number;
  value: (row: WorksheetRow) => string | number | null;
};

// Order is reading order, not import order: where it is, then what it is,
// then the empty columns you fill in. Description is last and narrow — it's
// occasionally useful and always the thing that ruins the layout.
const COLUMNS: Column[] = [
  { header: "Batch", width: 22, value: (r) => r.batchName },
  { header: "Box", width: 10, value: (r) => r.boxLabel },
  { header: "Location", width: 16, value: (r) => r.batchLocation },
  { header: "Call number", width: 22, value: (r) => r.book.lcc },
  { header: "Title", width: 46, value: (r) => r.book.title },
  {
    header: "Author",
    width: 26,
    value: (r) => (r.book.authors.length ? r.book.authors.join(" / ") : null),
  },
  { header: "Publisher", width: 24, value: (r) => r.book.publisher },
  { header: "Date", width: 10, value: (r) => r.book.pubDate },
  { header: "ISBN", width: 16, value: (r) => r.book.isbn13 || r.book.isbn10 },
  { header: "Status", width: 14, value: (r) => r.book.status.replace("_", " ") },
  // The four you fill in. Left empty deliberately — a pre-filled
  // "Undecided" reads as a decision someone already made.
  { header: "Decision", width: 14, value: () => null },
  { header: "Note", width: 40, value: () => null },
  { header: "Who", width: 10, value: () => null },
  { header: "When", width: 12, value: () => null },
  { header: "Description", width: 60, value: (r) => r.book.description },
];

const DECISION_COL = COLUMNS.findIndex((c) => c.header === "Decision") + 1;

function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export async function buildWorksheet(
  rows: WorksheetRow[],
  title: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carnegie";
  wb.created = new Date();

  const ws = wb.addWorksheet("Books", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));

  for (const row of rows) {
    ws.addRow(COLUMNS.map((c) => c.value(row) ?? ""));
  }

  const lastCol = columnLetter(COLUMNS.length);
  const lastRow = rows.length + 1;

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  // AutoFilter across the header turns "show me everything still Undecided
  // in call-number order" into two clicks.
  ws.autoFilter = `A1:${lastCol}1`;

  // Dropdown on every data row in the Decision column. Applied per cell
  // rather than to a range: exceljs exposes a `dataValidations.add(range)`
  // helper at runtime but doesn't declare it on the Worksheet type, and the
  // per-cell property is the typed, supported path.
  //
  // allowBlank because blank is the honest starting state — a pre-filled
  // value reads as a decision someone already made. showErrorMessage stops
  // a typo silently creating a fourth category that filters won't group.
  for (let r = 2; r <= lastRow; r++) {
    ws.getCell(r, DECISION_COL).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${DECISIONS.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Pick from the list",
      error: `Use one of: ${DECISIONS.join(", ")}.`,
    };
  }

  // Wrapping is off everywhere so one long description can't set the height
  // of a row you're trying to scan past. The text is still there; widen the
  // column or click the cell to read it.
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.alignment = { vertical: "top", wrapText: false };
  });

  const meta = wb.addWorksheet("About");
  meta.columns = [{ width: 18 }, { width: 90 }];
  meta.addRows([
    ["Exported", new Date().toLocaleString()],
    ["Source", title],
    ["Books", rows.length],
    [],
    [
      "Decision",
      `Pick from the dropdown: ${DECISIONS.join(", ")}. Filter the Decision column to see what's left.`,
    ],
    [
      "Box",
      "Which photographed box a book came from. Empty for books added before Carnegie started recording it.",
    ],
    [
      "Editing",
      "Changes here do not go back into Carnegie. Fix titles and call numbers in Carnegie; use this sheet for decisions.",
    ],
  ]);
  meta.getColumn(1).font = { bold: true };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// Filesystem-safe name, mirroring batchSlug in lib/csv.ts.
export function worksheetFilename(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "carnegie";
  return `${slug}-worksheet-${new Date().toISOString().slice(0, 10)}.xlsx`;
}
