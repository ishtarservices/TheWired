/**
 * CLI entrypoint for the project's custom SQL migration runner.
 *
 * Why this exists: `pnpm db:migrate` previously called `drizzle-kit migrate`,
 * which expects a `meta/_journal.json` (drizzle-kit-generated migrations). This
 * project hand-maintains numbered SQL files under `db/migrations/` and applies
 * them via `runMigrations()` (`migrate.ts`), tracked in `app.schema_migrations`.
 * Runs automatically on backend startup (`index.ts`) — this script lets you
 * apply migrations standalone without restarting the server.
 */
import { runMigrations } from "./migrate.js";

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate-cli] failed:", err);
    process.exit(1);
  });
