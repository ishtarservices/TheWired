/**
 * Test user nsec keys for Playwright E2E tests.
 *
 * Loaded from environment variables. Set via .env.test at repo root,
 * or pass directly: TEST_NSEC_LUNA_VEGA=nsec1... npx playwright test
 *
 * If missing, tests that require login will be skipped.
 */

function getEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

export const TEST_USERS = {
  lunaVega: {
    name: "Luna Vega",
    nsec: getEnv("TEST_NSEC_LUNA_VEGA"),
  },
  marcusCole: {
    name: "Marcus Cole",
    nsec: getEnv("TEST_NSEC_MARCUS_COLE"),
  },
  sageNakamura: {
    name: "Sage Nakamura",
    nsec: getEnv("TEST_NSEC_SAGE_NAKAMURA"),
  },
  niaOkafor: {
    name: "Nia Okafor",
    nsec: getEnv("TEST_NSEC_NIA_OKAFOR"),
  },
  riverChen: {
    name: "River Chen",
    nsec: getEnv("TEST_NSEC_RIVER_CHEN"),
  },
} as const;
