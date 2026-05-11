// One-shot helper: resize any eval/photos/*.jpg that exceeds the
// Anthropic vision raw-byte cap (3.75 MiB, derived from the 5 MiB
// base64-encoded limit). Writes in place. Safe to re-run.
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const CAP_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4); // 3,932,160
const PHOTOS_DIR = new URL("./photos/", import.meta.url).pathname.replace(/^\//, "");

const entries = await readdir(PHOTOS_DIR);
for (const name of entries) {
  if (!name.toLowerCase().endsWith(".jpg")) continue;
  const path = join(PHOTOS_DIR, name);
  const before = (await stat(path)).size;
  if (before <= CAP_BYTES) continue;

  // Iteratively shrink until under the cap. Start by capping long edge at
  // 2400px; back off in 200px steps if quality 85 still overshoots.
  let longEdge = 2400;
  let quality = 85;
  let outBuf;
  for (let attempt = 0; attempt < 8; attempt++) {
    outBuf = await sharp(await readFile(path))
      .rotate()
      .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (outBuf.length <= CAP_BYTES) break;
    longEdge -= 200;
    if (longEdge < 1200) {
      quality -= 5;
      longEdge = 2400;
    }
  }
  await writeFile(path, outBuf);
  const after = outBuf.length;
  console.log(
    `${name}: ${(before / 1024 / 1024).toFixed(2)} MiB -> ${(after / 1024 / 1024).toFixed(2)} MiB`,
  );
}
