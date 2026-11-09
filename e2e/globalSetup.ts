// Starts the built app in Docker Compose before the e2e tests, as a reviewer
// runs it, and stops it after, the same way on Linux, macOS and Windows.
//
// Not Playwright's webServer: it runs its command through a shell, so an
// environment variable set in the command (`MONGO_DB=… docker compose up`)
// only works in a POSIX shell, and it stops the command with a signal, which
// Windows doesn't have: there, the containers kept running after the tests.
// Here docker is started without a shell, with the variable in its
// environment, and stopped with `docker compose stop` on every system.
import { spawnSync } from "node:child_process";
import type { FullConfig } from "@playwright/test";

const startTimeoutMs = 180_000;

/** Runs `docker compose <args>`, showing its output; throws if it fails. */
function compose(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync("docker", ["compose", ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} exited with ${result.status}`,
    );
  }
}

/** Whether anything answers at the URL, whatever its status. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilHealthy(url: string): Promise<void> {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  compose(["logs", "app"]);
  throw new Error(`${url} didn't answer within ${startTimeoutMs / 1000} s`);
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const health = `${baseURL}/health`;

  // Fail instead of silently testing whatever else is on port 3000 (such as
  // `npm run dev`), which isn't the built image. Nothing started yet, so
  // there's nothing to stop.
  if (await answers(health)) {
    throw new Error(
      `${health} already answers: stop \`npm run dev\` or \`docker compose\` first`,
    );
  }

  // Each run starts from an empty waitlist: a party left over from an earlier
  // run would hold seats and change who is ready.
  const database = `e2e_${Date.now()}`;
  const stop = () => compose(["stop"]);
  try {
    compose(["up", "--build", "--detach"], {
      ...process.env,
      MONGO_DB: database,
    });
    await waitUntilHealthy(health);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
