/**
 * One-shot migration: rename `<sha>.<ext>` → `<sha>` in BLOB_DIR and strip the
 * matching suffix from `app.music_uploads.storage_path` and `.url`.
 *
 * Idempotent: files already bare are left alone; rows already stripped are no-ops.
 * Run after the Option-B code is deployed (the service must not be writing new
 * extensioned files, so the tree eventually reaches a fully-bare fixed point).
 *
 * Run (after `pnpm --filter @thewired/backend build`):
 *   node --env-file=.env dist/scripts/stripBlobExtensions.js
 * In prod container:
 *   docker compose exec backend node dist/scripts/stripBlobExtensions.js
 */
import { readdir, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { config } from "../config.js";

const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const SHA_WITH_EXT = /^([0-9a-f]{64})\.[A-Za-z0-9]+$/;
const SHA_BARE = /^[0-9a-f]{64}$/;

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((res, rej) => {
    const s = createReadStream(path);
    s.on("data", (c) => hash.update(c));
    s.on("end", () => res());
    s.on("error", rej);
  });
  return hash.digest("hex");
}

async function main() {
  console.log(`[migrate] BLOB_DIR=${BLOB_DIR}`);

  const entries = await readdir(BLOB_DIR, { withFileTypes: true });
  let renamed = 0;
  let alreadyBare = 0;
  let skipped = 0;
  let collisionDropped = 0;
  let collisionKept = 0;

  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (name.startsWith(".tmp_")) { skipped++; continue; }
    if (SHA_BARE.test(name)) { alreadyBare++; continue; }

    const m = name.match(SHA_WITH_EXT);
    if (!m) { skipped++; continue; }

    const sha = m[1];
    const src = join(BLOB_DIR, name);
    const dst = join(BLOB_DIR, sha);

    let bareExists = false;
    try { await stat(dst); bareExists = true; } catch { /* not present */ }

    if (!bareExists) {
      await rename(src, dst);
      renamed++;
      continue;
    }

    // Collision: both `<sha>` and `<sha>.<ext>` exist. Content-address says
    // they must be identical bytes — verify, then drop the extensioned copy.
    const [hSrc, hDst] = await Promise.all([sha256OfFile(src), sha256OfFile(dst)]);
    if (hSrc === sha && hDst === sha) {
      await unlink(src);
      collisionDropped++;
    } else {
      console.warn(`[migrate] HASH MISMATCH — keeping both: ${name} (src=${hSrc}, dst=${hDst}, expected=${sha})`);
      collisionKept++;
    }
  }

  console.log(`[migrate] disk: renamed=${renamed} alreadyBare=${alreadyBare} collisionDropped=${collisionDropped} collisionKept=${collisionKept} skipped=${skipped}`);

  const res = (await db.execute(
    sql`UPDATE app.music_uploads
           SET storage_path = regexp_replace(storage_path, '\.[A-Za-z0-9]+$', ''),
               url          = regexp_replace(url,          '\.[A-Za-z0-9]+$', '')
         WHERE storage_path ~ '\.[A-Za-z0-9]+$'
            OR url          ~ '\.[A-Za-z0-9]+$'`,
  )) as unknown as { rowCount?: number };
  console.log(`[migrate] music_uploads updated rows=${res.rowCount ?? "?"}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
