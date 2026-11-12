/**
 * One-off operator script: drop space-scoped (`h`-tagged) and non-public
 * (`visibility`-tagged) documents from the public `events` search index.
 *
 * Ingestion stopped indexing them (planIngest → indexSearch is false for any
 * non-public event), but documents indexed before that stayed searchable —
 * private-space chat included. GET /search is unauthenticated, so they go.
 *
 * Dev (repo root or services/backend):
 *   pnpm search:purge-nonpublic            (dry run: counts + a sample)
 *   pnpm search:purge-nonpublic --apply    (delete them)
 * Production (inside the backend container):
 *   node dist/scripts/purgeNonPublicSearchDocs.js [--apply]
 */
import { getMeilisearchClient } from "../lib/meilisearch.js";

type Doc = { id: string; kind?: number; tags?: unknown };

/** Same shape test as the ingester's isNonPublicEvent: an `h` or `visibility`
 *  tag with a value. */
export function isNonPublicDoc(doc: Doc): boolean {
  if (!Array.isArray(doc.tags)) return false;
  return doc.tags.some(
    (t) => Array.isArray(t) && (t[0] === "visibility" || t[0] === "h") && !!t[1],
  );
}

const PAGE = 1000;

async function main() {
  const apply = process.argv.includes("--apply");
  const index = getMeilisearchClient().index("events");

  const victims: string[] = [];
  const byKind = new Map<number, number>();
  let scanned = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await index.getDocuments<Doc>({ offset, limit: PAGE, fields: ["id", "kind", "tags"] });
    for (const doc of page.results) {
      scanned++;
      if (!isNonPublicDoc(doc)) continue;
      victims.push(doc.id);
      byKind.set(doc.kind ?? -1, (byKind.get(doc.kind ?? -1) ?? 0) + 1);
    }
    if (page.results.length < PAGE) break;
  }

  console.log(`scanned ${scanned} documents; ${victims.length} non-public`);
  for (const [kind, n] of [...byKind.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  kind ${kind}: ${n}`);
  }
  if (victims.length === 0) return;
  if (!apply) {
    console.log(`sample: ${victims.slice(0, 5).join(", ")}`);
    console.log("dry run — re-run with --apply to delete them");
    return;
  }
  for (let i = 0; i < victims.length; i += PAGE) {
    const batch = victims.slice(i, i + PAGE);
    await index.deleteDocuments(batch).waitTask({ timeout: 120_000 });
    console.log(`deleted ${Math.min(i + PAGE, victims.length)}/${victims.length}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[purge-nonpublic] failed:", err);
    process.exit(1);
  },
);
