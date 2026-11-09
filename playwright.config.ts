import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  // Tests run against the built app in Docker Compose, as a reviewer runs it:
  // started on an empty database before the tests and stopped after them,
  // on every operating system (see globalSetup.ts).
  globalSetup: "./e2e/globalSetup.ts",
  use: {
    baseURL,
    // JavaScript off by default: the suite passing proves the app is
    // server-rendered and works without client code. Only copyLink.spec.ts
    // and liveCard.spec.ts turn it on, for the Copy button and the card's
    // live updates.
    javaScriptEnabled: false,
  },
  // Diners use phones, so tests run in a phone-sized browser.
  // The live-card and check-in journeys each need an empty restaurant: other
  // parties would hold seats and change who is ready. So each runs in a
  // project of its own, one after the other, and the rest wait for them:
  // files in one project may run at the same time.
  projects: [
    {
      name: "live-card",
      testMatch: "liveCard.spec.ts",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "check-in",
      testMatch: "checkIn.spec.ts",
      dependencies: ["live-card"],
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "phone",
      testIgnore: /(checkIn|liveCard)\.spec\.ts/,
      dependencies: ["check-in"],
      use: { ...devices["Pixel 7"] },
    },
  ],
});
