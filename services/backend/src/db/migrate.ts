import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function runMigrations() {
  const sql = postgres(config.databaseUrl);

  try {
    // Ensure the app schema exists before anything else
    await sql`CREATE SCHEMA IF NOT EXISTS app`;

    // Create the tracking table inline (not as a migration file)
    await sql`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Get already-applied migrations
    const applied = await sql<{ filename: string }[]>`
      SELECT filename FROM app.schema_migrations ORDER BY filename
    `;
    const appliedSet = new Set(applied.map((r) => r.filename));

    // Get all migration files
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    let newCount = 0;

    for (const file of sqlFiles) {
      if (appliedSet.has(file)) {
        continue;
      }

      const content = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
      await sql.unsafe(content);
      await sql`INSERT INTO app.schema_migrations (filename) VALUES (${file})`;
      console.log(`[migrations] Applied ${file}`);
      newCount++;
    }

    if (newCount === 0) {
      console.log(`[migrations] Up to date (${appliedSet.size} migrations already applied)`);
    } else {
      console.log(`[migrations] Applied ${newCount} new migration(s), ${appliedSet.size + newCount} total`);
    }
  } finally {
    await sql.end();
  }
}
