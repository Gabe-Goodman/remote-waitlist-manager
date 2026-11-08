import { defineConfig } from "vitest/config";

// Unit and integration tests live next to the code they test, in src/.
// Playwright owns e2e/, so Vitest must not pick those files up.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // The pages link the built browser script, so it's built once first.
    globalSetup: "vitest.globalSetup.ts",
  },
});
