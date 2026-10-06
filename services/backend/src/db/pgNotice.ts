import type { Options, PostgresType } from "postgres";

/**
 * postgres.js prints every server notice through `console.log` by default.
 * Our migrations are idempotent (`IF NOT EXISTS` everywhere) and the test
 * harness re-applies them per test file, so a CI log is tens of thousands of
 * `relation … already exists, skipping` objects that bury real failures.
 * Keep anything a human should see (WARNING and above); drop plain NOTICEs.
 */
export const onnotice: NonNullable<Options<Record<string, PostgresType>>["onnotice"]> = (notice) => {
  if (notice.severity === "NOTICE" || notice.severity_local === "NOTICE") return;
  console.warn("[postgres]", notice.severity, notice.message);
};
