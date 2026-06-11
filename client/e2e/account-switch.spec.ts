/**
 * Multi-account add/switch smoke — the highest regression-risk area of the
 * remediation (#3 account-switch state isolation, #77 follower-merge, #116
 * sign-pubkey guard).
 *
 * The deterministic isolation assertions are unit-probe-covered; this E2E drives
 * the real UI through "add a second identity → navigate → (switch if exposed)"
 * under the console/page-error guard. The value: the add-account flow runs
 * performLogin → performCleanup → setActivePubkey on the live keystore, which is
 * exactly where the synchronous-key-capture / flush-ordering changes would throw.
 */
import { test, expect } from "@playwright/test";
import { installTauriMock } from "./support/tauriKeystoreMock";
import { installConsoleGuard, appErrors, loginGenerate, gotoApp, clickPastWizard, dismissProfileWizard } from "./helpers/session";

// The first-run profile wizard re-renders on every reload for a profile-less
// account and races the dismiss under parallel CPU load — retry to absorb that.
test.describe.configure({ retries: 2 });

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test("add a second account and navigate without errors", async ({ page }) => {
  const guard = installConsoleGuard(page);

  // Account A.
  await loginGenerate(page);

  // Settings → App tab (Accounts section). Two "Add Account" buttons exist
  // (sidebar profile card + this section); the section's is last in the DOM.
  await gotoApp(page, "/settings?tab=app");
  await clickPastWizard(page, page.getByRole("button", { name: /add account/i }).last());

  // Add-account modal → generate account B. This runs the full login + cleanup +
  // setActivePubkey path on the live keystore.
  await clickPastWizard(page, page.getByRole("button", { name: /generate new identity/i }));
  await dismissProfileWizard(page);

  // App is still alive after the add/switch flow, with no app-level errors —
  // which is exactly where the account-switch (#3) / sign-pubkey (#116) changes
  // would surface a regression.
  await expect(page.locator("body")).not.toBeEmpty({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(appErrors(guard.errors())).toEqual([]);
});
