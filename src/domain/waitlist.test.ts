// The joining rules as unit tests: plain values in and out, no database.
import { describe, expect, test } from "vitest";
import {
  join,
  partiesWaiting,
  partyPlace,
  validateJoin,
  type Party,
} from "./waitlist.js";

const valid = { name: "Ana", email: "ana@example.com", size: "2" };

/** An email of exactly `length` characters, shaped like x@y.z. */
function emailOfLength(length: number): string {
  const local = "a".repeat(64);
  return `${local}@${"b".repeat(length - local.length - 5)}.com`;
}

describe("validating the join form", () => {
  test("reports every invalid field at once", () => {
    const result = validateJoin({ name: "", email: "nope", size: "0" });

    expect(result).toEqual({
      ok: false,
      errors: { name: "required", email: "invalid", size: "invalid" },
    });
  });

  test("reports a name of only spaces as required", () => {
    const result = validateJoin({ ...valid, name: " " });

    expect(result).toEqual({ ok: false, errors: { name: "required" } });
  });

  test("reports a missing email as required, not invalid", () => {
    const result = validateJoin({ ...valid, email: "  " });

    expect(result).toEqual({ ok: false, errors: { email: "required" } });
  });

  test("accepts a name of 50 characters and refuses 51", () => {
    expect(validateJoin({ ...valid, name: "x".repeat(50) }).ok).toBe(true);
    expect(validateJoin({ ...valid, name: "x".repeat(51) })).toEqual({
      ok: false,
      errors: { name: "too-long" },
    });
  });

  test("accepts an email of 254 characters and refuses 255", () => {
    expect(validateJoin({ ...valid, email: emailOfLength(254) }).ok).toBe(true);
    expect(validateJoin({ ...valid, email: emailOfLength(255) })).toEqual({
      ok: false,
      errors: { email: "too-long" },
    });
  });

  test("refuses an email without the x@y.z shape", () => {
    for (const email of ["ana", "ana@example", "@example.com", "a na@x.com"]) {
      expect(validateJoin({ ...valid, email })).toEqual({
        ok: false,
        errors: { email: "invalid" },
      });
    }
  });

  test("accepts party sizes 1 to 10 and refuses anything else", () => {
    expect(validateJoin({ ...valid, size: "1" }).ok).toBe(true);
    expect(validateJoin({ ...valid, size: "10" }).ok).toBe(true);
    for (const size of ["0", "11", "2.5", "two", "", "1e1"]) {
      expect(validateJoin({ ...valid, size })).toEqual({
        ok: false,
        errors: { size: "invalid" },
      });
    }
  });

  test("trims the name and stores the email trimmed and lowercased", () => {
    const result = validateJoin({
      name: "  Ana  ",
      email: "  Ana@Example.COM ",
      size: " 3 ",
    });

    expect(result).toEqual({
      ok: true,
      details: { name: "Ana", email: "ana@example.com", size: 3 },
    });
  });
});

const context = { now: new Date("2026-11-07T18:00:00Z"), token: "token-ana" };

function partyNamed(name: string): Party {
  return {
    token: `token-${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    size: 2,
    joinedAt: new Date("2026-11-07T17:50:00Z"),
  };
}

describe("joining", () => {
  test("adds a party at the back of the queue", () => {
    const waitlist = { parties: [partyNamed("Ben")] };

    const result = join(waitlist, valid, context);

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.waitlist.parties.map((p) => p.name)).toEqual(["Ben", "Ana"]);
  });

  test("gives the party the token and join time it is handed", () => {
    const result = join({ parties: [] }, valid, context);

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.party).toEqual({
      token: "token-ana",
      name: "Ana",
      email: "ana@example.com",
      size: 2,
      joinedAt: context.now,
    });
  });

  test("refuses an invalid form", () => {
    const result = join({ parties: [] }, { ...valid, size: "0" }, context);

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: { size: "invalid" },
    });
  });

  test("never changes the waitlist it is given", () => {
    const waitlist = { parties: [partyNamed("Ben")] };

    join(waitlist, valid, context);
    join(waitlist, { ...valid, size: "0" }, context);
    join(waitlist, { ...valid, email: "ben@example.com" }, context);

    expect(waitlist.parties.map((p) => p.name)).toEqual(["Ben"]);
  });
});

describe("never on the list twice", () => {
  test("refuses an email that is already on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    const result = join(waitlist, valid, context);

    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  test("treats the same email in different case or with spaces as a duplicate", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    const result = join(
      waitlist,
      { ...valid, email: "  ANA@Example.com " },
      context,
    );

    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  test("reports an invalid form as invalid, even when the email is taken", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    const result = join(waitlist, { ...valid, size: "0" }, context);

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: { size: "invalid" },
    });
  });
});

describe("your place in the queue", () => {
  test("counts the parties ahead of you", () => {
    const waitlist = {
      parties: [partyNamed("Ben"), partyNamed("Cy"), partyNamed("Ana")],
    };

    const place = partyPlace(waitlist, "token-Ana");

    expect(place?.party.name).toBe("Ana");
    expect(place?.ahead).toBe(2);
  });

  test("gives a newcomer every waiting party ahead of them", () => {
    const waitlist = { parties: [partyNamed("Ben"), partyNamed("Cy")] };

    expect(partiesWaiting(waitlist)).toBe(2);
  });

  test("doesn't know a token that isn't on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ben")] };

    expect(partyPlace(waitlist, "token-nobody")).toBeUndefined();
  });
});
