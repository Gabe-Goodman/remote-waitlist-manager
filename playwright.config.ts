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
    // turns it on, for the Copy button.
    javaScriptEnabled: false,
  },
  // Diners use phones, so tests run in a phone-sized browser.
  // The check-in journey needs an empty restaurant: the other journeys'
  // parties would hold seats and change who is ready. So it runs first,
  // on its own, and the rest wait for it.
  projects: [
    {
      name: "check-in",
      testMatch: "checkIn.spec.ts",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "phone",
      testIgnore: "checkIn.spec.ts",
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
