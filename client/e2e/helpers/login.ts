import { type Page, expect } from "@playwright/test";

/**
 * Log into the app by importing an nsec key.
 * Assumes the app is showing the login screen.
 */
export async function loginWithNsec(page: Page, nsec: string) {
  // Wait for the login screen to be visible
  await page.waitForSelector('[data-testid="login-screen"], [data-testid="import-key-button"], text=/import|key|sign in/i', {
    timeout: 15_000,
  });

  // Click the import key option
  const importButton = page.getByRole("button", { name: /import.*key|nsec/i });
  if (await importButton.isVisible()) {
    await importButton.click();
  }

  // Fill in the nsec input
  const nsecInput = page.locator('input[type="password"], input[placeholder*="nsec"], input[placeholder*="key"]');
  await nsecInput.fill(nsec);

  // Submit
  const submitButton = page.getByRole("button", { name: /login|import|continue|sign in/i });
  await submitButton.click();

  // Wait for the main app layout to appear (login complete)
  await page.waitForSelector('[data-testid="main-layout"], [data-testid="sidebar"], nav', {
    timeout: 30_000,
  });
}
