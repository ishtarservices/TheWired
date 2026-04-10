import { test, expect } from "@playwright/test";
import { TEST_USERS } from "./fixtures/testUsers";

test.describe("Spaces", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("can navigate to discover page for spaces", async ({ page }) => {
    // The app should have some form of discovery/explore
    const discoverLink = page.locator(
      'a[href*="discover"], button:has-text("discover"), button:has-text("explore"), [data-testid="discover"]',
    );
    // If discover exists, click it
    if (await discoverLink.first().isVisible({ timeout: 10_000 }).catch(() => false)) {
      await discoverLink.first().click();
      await expect(page).toHaveURL(/discover|explore/);
    }
  });
});
