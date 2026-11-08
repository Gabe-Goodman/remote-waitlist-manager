import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

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
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  // Tests run against the built app in Docker Compose, as a reviewer runs it.
  webServer: {
    command: "docker compose up --build",
    url: `${baseURL}/health`,
    // Fail instead of silently testing whatever else is on port 3000
    // (such as `npm run dev`), which isn't the built image.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
