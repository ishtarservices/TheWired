import { test, expect } from "@playwright/test";
import { TEST_USERS } from "./fixtures/testUsers";

test.describe("Login Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows login screen on first visit", async ({ page }) => {
    // The app should show some form of login/onboarding
    const loginArea = page.locator("text=/sign in|import|login|get started/i");
    await expect(loginArea.first()).toBeVisible({ timeout: 15_000 });
  });

  test("has an option to import an nsec key", async ({ page }) => {
    // Look for import key button/option
    const importOption = page.locator(
      "text=/import.*key|nsec|private key|existing.*key/i",
    );
    await expect(importOption.first()).toBeVisible({ timeout: 15_000 });
  });

  test("shows an nsec input field when import is selected", async ({ page }) => {
    // Click import option
    const importOption = page.locator(
      "text=/import.*key|nsec|private key|existing.*key/i",
    );
    await importOption.first().click();

    // Should show an input for the nsec
    const nsecInput = page.locator(
      'input[type="password"], input[placeholder*="nsec"], input[placeholder*="key"]',
    );
    await expect(nsecInput.first()).toBeVisible({ timeout: 10_000 });
  });
});
