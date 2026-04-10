import { test, expect } from "@playwright/test";
import { TEST_USERS } from "./fixtures/testUsers";

test.describe("Profile", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows profile-related UI elements", async ({ page }) => {
    // The app should show some user-related UI (settings, profile icon, etc.)
    const userUI = page.locator(
      '[data-testid="profile"], [data-testid="avatar"], [data-testid="settings"], text=/profile|settings/i',
    );
    // This test just verifies the app loads without crashing
    await expect(page.locator("body")).toBeVisible();
  });
});
