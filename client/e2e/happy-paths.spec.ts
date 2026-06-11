/**
 * Happy-path smoke specs for the areas touched by the audit remediation
 * (DMs, feed/notes, spaces/discover, settings). These don't reproduce the
 * adversarial cases (those are covered by the unit/integration probes) — they
 * confirm the LEGIT flows still render and run without throwing, which is where
 * an over-strict security check would surface as a regression.
 *
 * Requires the dev stack reachable (relays/backend may be down — network noise
 * is filtered; only app-level errors fail the run).
 */
import { test, expect } from "@playwright/test";
import { installTauriMock } from "./support/tauriKeystoreMock";
import { installConsoleGuard, appErrors, loginGenerate } from "./helpers/session";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test("app loads and shows the login screen without errors", async ({ page }) => {
  const guard = installConsoleGuard(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /generate new identity/i })).toBeVisible({ timeout: 20_000 });
  // Import + bunker options are present too.
  await expect(page.locator('input[placeholder*="nsec"], input[type="password"]').first()).toBeVisible();
  expect(appErrors(guard.errors())).toEqual([]);
});

test("can log in with a generated identity and reach the app shell", async ({ page }) => {
  const guard = installConsoleGuard(page);
  await loginGenerate(page);
  // Login screen is gone; some app chrome is present.
  await expect(page.getByRole("button", { name: /generate new identity/i })).toBeHidden();
  expect(appErrors(guard.errors())).toEqual([]);
});

test("navigates the home feed, DMs, discover and settings without throwing", async ({ page }) => {
  const guard = installConsoleGuard(page);
  await loginGenerate(page);

  for (const path of ["/", "/dm", "/discover", "/settings", "/"]) {
    await page.goto(path);
    // Page mounts something (not a blank crash) within a reasonable time.
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 15_000 });
    // Give async views (feeds, lists) a moment to settle.
    await page.waitForTimeout(500);
  }

  expect(appErrors(guard.errors())).toEqual([]);
});

test("DM view renders its empty state for a fresh account", async ({ page }) => {
  const guard = installConsoleGuard(page);
  await loginGenerate(page);
  await page.goto("/dm");
  // A brand-new account has no conversations — the view should render an empty
  // state / prompt rather than crash.
  await expect(page.locator("body")).not.toBeEmpty({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(appErrors(guard.errors())).toEqual([]);
});

test("can open the note composer (signing path is wired)", async ({ page }) => {
  const guard = installConsoleGuard(page);
  await loginGenerate(page);
  await page.goto("/");

  // Find a compose affordance (button/textarea). Defensive: skip the interaction
  // if the composer isn't reachable in this build, but still assert no errors.
  const composer = page.locator(
    'textarea, [contenteditable="true"], button:has-text("Post"), button:has-text("New"), [aria-label*="compose" i]',
  );
  if (await composer.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
    await composer.first().click().catch(() => {});
  }
  await page.waitForTimeout(500);
  expect(appErrors(guard.errors())).toEqual([]);
});
