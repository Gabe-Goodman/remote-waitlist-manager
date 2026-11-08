import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
// Each run starts from an empty waitlist: a party left over from an earlier
// run would hold seats and change who is ready.
const database = `e2e_${Date.now()}`;

export default defineConfig({
  testDir: "e2e",
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
  // Tests run against the built app in Docker Compose, as a reviewer runs it.
  webServer: {
    command: `MONGO_DB=${database} docker compose up --build`,
    url: `${baseURL}/health`,
    // Fail instead of silently testing whatever else is on port 3000
    // (such as `npm run dev`), which isn't the built image.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
