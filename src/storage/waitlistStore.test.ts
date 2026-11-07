// The store against the real MongoDB from Compose, one fresh collection per test.
import { describe, expect, test } from "vitest";
import type { Party } from "../domain/waitlist.js";
import { freshCollection } from "./testDb.js";
import { waitlistStore, type WaitlistDocument } from "./waitlistStore.js";

function partyNamed(name: string): Party {
  return {
    token: `token-${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    size: 2,
    joinedAt: new Date("2026-11-07T18:00:00Z"),
  };
}

describe("storing the waitlist", () => {
  test("starts with an empty waitlist at version 0", async () => {
    const store = waitlistStore(freshCollection<WaitlistDocument>());

    await store.ensureExists();

    expect(await store.load()).toEqual({
      waitlist: { parties: [] },
      version: 0,
    });
  });

  test("leaves an existing waitlist alone when asked to create it again", async () => {
    const collection = freshCollection<WaitlistDocument>();
    const ana = {
      token: "token-ana",
      name: "Ana",
      email: "ana@example.com",
      size: 2,
      joinedAt: new Date("2026-11-07T18:00:00Z"),
    };
    await collection.insertOne({ _id: "main", version: 3, parties: [ana] });

    await waitlistStore(collection).ensureExists();

    expect(await waitlistStore(collection).load()).toEqual({
      waitlist: { parties: [ana] },
      version: 3,
    });
  });
});

describe("saving only if nobody saved in between", () => {
  test("refuses a save from a stale version and writes nothing", async () => {
    const collection = freshCollection<WaitlistDocument>();
    await collection.insertOne({
      _id: "main",
      version: 1,
      parties: [partyNamed("Ben")],
    });
    const store = waitlistStore(collection);

    const result = await store.saveIfVersion(
      { parties: [partyNamed("Ana")] },
      0,
    );

    expect(result).toBe("conflict");
    expect(await store.load()).toEqual({
      waitlist: { parties: [partyNamed("Ben")] },
      version: 1,
    });
  });

  test("saves when the version matches, and bumps it", async () => {
    const store = waitlistStore(freshCollection<WaitlistDocument>());
    await store.ensureExists();

    const result = await store.saveIfVersion(
      { parties: [partyNamed("Ana")] },
      0,
    );

    expect(result).toBe("saved");
    expect(await store.load()).toEqual({
      waitlist: { parties: [partyNamed("Ana")] },
      version: 1,
    });
  });

  test("lets only one of two simultaneous saves from the same version win", async () => {
    const store = waitlistStore(freshCollection<WaitlistDocument>());
    await store.ensureExists();

    const results = await Promise.all([
      store.saveIfVersion({ parties: [partyNamed("Ana")] }, 0),
      store.saveIfVersion({ parties: [partyNamed("Ben")] }, 0),
    ]);

    expect(results.toSorted()).toEqual(["conflict", "saved"]);
    const { waitlist, version } = await store.load();
    expect(version).toBe(1);
    expect(waitlist.parties).toHaveLength(1);
  });

  test("loads joinedAt back as a Date", async () => {
    const store = waitlistStore(freshCollection<WaitlistDocument>());
    await store.ensureExists();
    await store.saveIfVersion({ parties: [partyNamed("Ana")] }, 0);

    const { waitlist } = await store.load();

    expect(waitlist.parties[0]?.joinedAt).toBeInstanceOf(Date);
  });
});
