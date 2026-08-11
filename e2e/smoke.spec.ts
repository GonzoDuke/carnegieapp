import { test, expect } from "@playwright/test";

// One end-to-end pass covering the spine of Carnegie: passcode login,
// new batch from the home dialog, quick-add by ISBN (which hits the
// real lookup chain), and CSV export. If any of these break, the app
// isn't usable — that's the whole point of a smoke test.
//
// PIN defaults to the dev passcode the tester guide hands out. Override
// with E2E_PIN in CI or against a different environment.
const PIN = process.env.E2E_PIN || "112511";

// The Great Gatsby — well-cataloged by every provider in the chain, so
// the lookup reliably hits even if one of ISBNdb / Google Books / OL is
// slow or rate-limited.
const TEST_ISBN = "9780743273565";

test("login → create batch → quick-add ISBN → export CSV", async ({
  page,
}) => {
  // --- Login ---
  await page.goto("/login");
  await page.getByLabel("Passcode").fill(PIN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.waitForLoadState("networkidle");
  const newBatchBtn = page.getByRole("button", { name: /new batch/i });
  await expect(newBatchBtn).toBeVisible();

  // --- Create batch ---
  const batchName = `Smoke ${Date.now()}`;
  // Click the trigger and poll for the dialog's name input. In Turbopack
  // dev mode the Base UI dialog chunk sometimes isn't wired up at the
  // moment of first click — retry the trigger a few times until the
  // dialog actually opens.
  const nameInput = page.locator("#name");
  await expect(async () => {
    await newBatchBtn.click();
    await expect(nameInput).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await nameInput.fill(batchName);
  await page.getByRole("button", { name: /create batch/i }).click();

  await expect(page).toHaveURL(/\/batches\/[^/?#]+/);
  const batchId = page.url().match(/\/batches\/([^/?#]+)/)?.[1];
  expect(batchId, "expected /batches/[id] URL after create").toBeTruthy();
  await expect(
    page.getByRole("heading", { level: 1, name: batchName }),
  ).toBeVisible();

  // --- Quick-add ISBN (home page) ---
  await page.goto("/");
  // QuickAddBar defaults to the most-recently-active batch, but pick
  // ours explicitly so the test isn't sensitive to ordering quirks.
  await page.locator("#quick-add-batch").selectOption({ value: batchId! });
  await page.locator("#quick-add-isbn").fill(TEST_ISBN);
  await page.getByRole("button", { name: /^add$/i }).click();

  await expect(page).toHaveURL(
    new RegExp(`/batches/${batchId}\\?manual=hit`),
  );
  await expect(page.getByText(/book added/i)).toBeVisible();

  // --- Export ---
  // ExportButton renders as <a href=".../export.csv" download>, so it
  // shows up as a link role. Filter on the "(1)" count so we don't
  // accidentally match a stale "(0)" variant during a slow render.
  //
  // The book is still pending_review at this point, so confirm it first —
  // only confirmed books are exported.
  await page.getByRole("button", { name: /confirm this book/i }).click();
  await expect(page).toHaveURL(new RegExp(`/batches/${batchId}`));

  const exportLink = page.getByRole("link", { name: /download csv \(1\)/i });
  await expect(exportLink).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await exportLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  // Downloading must not archive the batch. This used to be a side effect
  // of the GET, which meant pulling a working copy silently filed the batch
  // away with no way back. "Mark complete" still being offered is the proof
  // the batch is still on the workbench.
  await page.reload();
  await expect(
    page.getByRole("button", { name: /mark complete/i }),
  ).toBeVisible();

  // --- Complete / reopen round trip ---
  await page.getByRole("button", { name: /mark complete/i }).click();
  await expect(page.getByText(/^Completed /)).toBeVisible();
  await page.getByRole("button", { name: /reopen/i }).click();
  await expect(
    page.getByRole("button", { name: /mark complete/i }),
  ).toBeVisible();
});
