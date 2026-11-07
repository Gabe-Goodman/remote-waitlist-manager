// The use cases. The retry loop runs with a plain stub; joining runs
// against the real MongoDB from Compose, one fresh collection per test.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { freshCollection } from "../storage/testDb.js";
import {
  waitlistStore,
  type WaitlistDocument,
} from "../storage/waitlistStore.js";
import { joinWaitlist, retryOnConflict } from "./waitlistService.js";

describe("retrying a save that conflicted", () => {
  test("succeeds on the next attempt after one conflict", async () => {
    const answers = ["conflict", "saved"] as const;
    let calls = 0;

    const result = await retryOnConflict(
      () => Promise.resolve(answers[calls++]),
      10,
    );

    expect(result).toBe("saved");
    expect(calls).toBe(2);
  });

  test("gives up as busy after the last attempt", async () => {
    let calls = 0;

    const result = await retryOnConflict(() => {
      calls++;
      return Promise.resolve("conflict" as const);
    }, 3);

    expect(result).toBe("busy");
    expect(calls).toBe(3);
  });

  test("never retries an exception", async () => {
    let calls = 0;

    const result = retryOnConflict(() => {
      calls++;
      return Promise.reject(new Error("database down"));
    }, 10);

    await expect(result).rejects.toThrow("database down");
    expect(calls).toBe(1);
  });
});

const env = {
  now: () => new Date("2026-11-07T18:00:00Z"),
  newToken: () => randomUUID(),
};

async function emptyStore() {
  const store = waitlistStore(freshCollection<WaitlistDocument>());
  await store.ensureExists();
  return store;
}

describe("joining the waitlist", () => {
  test("saves a new party so it loads back", async () => {
    const store = await emptyStore();

    const outcome = await joinWaitlist(store, env, {
      name: "Ana",
      email: "ana@example.com",
      size: "2",
    });

    if (!outcome.ok)
      throw new Error(`join refused: ${JSON.stringify(outcome)}`);
    const { waitlist } = await store.load();
    expect(waitlist.parties).toEqual([outcome.party]);
  });

  test("refuses an invalid form without saving anything", async () => {
    const store = await emptyStore();

    const outcome = await joinWaitlist(store, env, {
      name: "",
      email: "ana@example.com",
      size: "2",
    });

    expect(outcome).toEqual({
      ok: false,
      reason: "invalid",
      errors: { name: "required" },
    });
    expect(await store.load()).toEqual({
      waitlist: { parties: [] },
      version: 0,
    });
  });

  test("lets 20 simultaneous joins in: all saved, none busy", async () => {
    const store = await emptyStore();
    const forms = Array.from({ length: 20 }, (_, i) => ({
      name: `Party ${i}`,
      email: `party${i}@example.com`,
      size: "2",
    }));

    const outcomes = await Promise.all(
      forms.map((form) => joinWaitlist(store, env, form)),
    );

    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);
    const { waitlist } = await store.load();
    expect(waitlist.parties).toHaveLength(20);
  });

  test("lets only one of two simultaneous joins with the same email in", async () => {
    const store = await emptyStore();
    const form = { name: "Ana", email: "ana@example.com", size: "2" };

    const outcomes = await Promise.all([
      joinWaitlist(store, env, form),
      joinWaitlist(store, env, form),
    ]);

    expect(outcomes.map((outcome) => outcome.ok).toSorted()).toEqual([
      false,
      true,
    ]);
    expect(outcomes).toContainEqual({ ok: false, reason: "duplicate" });
    const { waitlist } = await store.load();
    expect(waitlist.parties).toHaveLength(1);
  });
});
