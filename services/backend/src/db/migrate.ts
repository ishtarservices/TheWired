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
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    for (const file of sqlFiles) {
      const content = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
      await sql.unsafe(content);
      console.log(`[migrations] Applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}
