import { type Page, expect } from "@playwright/test";

/**
 * Collect uncaught page errors + console errors over a test. The single most
 * valuable regression signal: any flow that throws shows up here.
 *
 * Some console errors are environmental (a relay/backend being down in the E2E
 * env), so callers filter with `errors()` and assert on the app-level ones.
 */
export function installConsoleGuard(page: Page): { errors: () => string[] } {
  const collected: string[] = [];
  page.on("pageerror", (err) => collected.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") collected.push(`console.error: ${msg.text()}`);
  });
  return { errors: () => collected };
}

/** Network/relay noise that is expected when the full stack isn't reachable. */
const ENV_NOISE = /websocket|ws:\/\/|wss:\/\/|fetch|networkerror|err_connection|failed to load|net::|ECONN|relay|status of 4\d\d|status of 5\d\d/i;

/** App-level errors only (filters out env/network noise). */
export function appErrors(errors: string[]): string[] {
  return errors.filter((e) => !ENV_NOISE.test(e));
}

async function waitForApp(page: Page): Promise<void> {
  // Login screen gone (Generate button detached) → app shell mounted.
  await expect(page.getByRole("button", { name: /generate new identity/i })).toBeHidden({ timeout: 30_000 });
  await dismissProfileWizard(page);
}

/** A freshly generated account opens the first-run ProfileWizard modal (close → Skip).
 *  Detected by its overlay container (the welcome title is split into per-char
 *  animated spans, so text matching is unreliable). */
export async function dismissProfileWizard(page: Page, timeout = 4_000): Promise<void> {
  // The ProfileWizard and generic <Modal>s share an overlay class; only the
  // wizard lacks `animate-fade-in-up`. Scope to it so we never close a real modal
  // (e.g. the Add-Account modal) by mistake.
  const WIZ = "div.fixed.inset-0.z-50:not(.animate-fade-in-up)";
  const overlay = page.locator(WIZ).first();
  if (!(await overlay.isVisible({ timeout }).catch(() => false))) return;
  // Top-right close (X) opens the skip-confirm, then "Skip" dismisses the wizard.
  await page.locator(`${WIZ} button:has(svg.lucide-x)`).first().click().catch(() => {});
  await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 3_000 }).catch(() => {});
  await overlay.waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
}

/** Full-reload navigate, then dismiss the first-run wizard that re-appears for a
 *  profile-less account (page.goto resets the SPA's Redux state; the wizard shows
 *  after async auto-login, so we wait generously for it). */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await dismissProfileWizard(page, 9_000);
}

/** Click a target that the first-run wizard may keep covering: dismiss any wizard
 *  (which can re-appear late, after async auto-login) and retry the click. */
export async function clickPastWizard(page: Page, locator: import("@playwright/test").Locator): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await dismissProfileWizard(page, 1_500);
    try {
      await locator.click({ timeout: 3_000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  await locator.click(); // final attempt surfaces the real error if still blocked
}

/** Log in by generating a brand-new identity (no nsec/env needed). */
export async function loginGenerate(page: Page): Promise<void> {
  await page.goto("/");
  const generate = page.getByRole("button", { name: /generate new identity/i });
  await expect(generate).toBeVisible({ timeout: 20_000 });
  await generate.click();
  await waitForApp(page);
}

/** Import a specific nsec (used to add a second account). Assumes the import UI
 *  is visible (login screen or add-account modal). */
export async function importNsecInVisibleForm(page: Page, nsec: string): Promise<void> {
  const input = page.locator('input[placeholder*="nsec"], input[type="password"]');
  await input.first().fill(nsec);
  await page.getByRole("button", { name: /^import$|import key/i }).first().click();
}
