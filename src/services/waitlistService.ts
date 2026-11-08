// Use cases only: load the waitlist, apply a rule, save if nobody saved in
// between, retry on conflict. No HTTP and no MongoDB queries here.
import { setTimeout as sleep } from "node:timers/promises";
import {
  checkIn,
  joinWaitlist,
  leaveWaitlist,
  partiesWaiting,
  partyState,
  type FieldErrors,
  type JoinForm,
  type Party,
  type PartyState,
} from "../domain/waitlist.js";
import type { WaitlistStore } from "../storage/waitlistStore.js";

/** The outside world a use case needs: the clock and new tokens. */
export type Environment = { now(): Date; newToken(): string };

export type JoinOutcome =
  | { ok: true; party: Party }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "duplicate" }
  | { ok: false; reason: "busy" };

export type CheckInOutcome =
  | { ok: true; party: Party }
  | {
      ok: false;
      reason: "not-found" | "not-ready" | "already-checked-in" | "busy";
    };

export type LeaveOutcome =
  | { ok: true; party: Party }
  | { ok: false; reason: "not-found" | "seated" | "already-left" | "busy" };

/**
 * Runs `attempt` (one load → rule → save) until it doesn't conflict, at most
 * `maxAttempts` times. Exceptions are never retried: only a conflict means
 * "someone else saved first, try again".
 */
export async function retryOnConflict<T>(
  attempt: () => Promise<T | "conflict">,
  maxAttempts: number,
): Promise<T | "busy"> {
  for (let tries = 1; tries <= maxAttempts; tries++) {
    const result = await attempt();
    if (result !== "conflict") return result;
    // A random pause of 0–25 ms: requests that collided once would collide
    // again if they all retried at the same moment.
    if (tries < maxAttempts) await sleep(Math.random() * 25);
  }
  return "busy";
}

// Enough for a burst of simultaneous joins, check-ins or leaves; past it, the
// request ends as busy rather than retrying forever.
const maxAttempts = 10;

/**
 * Adds a party to the waitlist. Each attempt reloads and re-runs the rule,
 * so a duplicate that slipped in during a conflict is still caught.
 */
async function joinAndSave(
  store: WaitlistStore,
  env: Environment,
  form: JoinForm,
): Promise<JoinOutcome> {
  const outcome = await retryOnConflict(async () => {
    const { waitlist, version } = await store.load();
    const context = { now: env.now(), token: env.newToken() };
    const result = joinWaitlist(waitlist, form, context);
    if (!result.ok) return result;
    // The form already made this party and nothing changed: saving would
    // only bump the version and make concurrent writes retry for nothing.
    if (!result.created) return { ok: true as const, party: result.party };

    const saved = await store.saveIfVersion(result.waitlist, version);
    if (saved === "conflict") return "conflict";
    return { ok: true as const, party: result.party };
  }, maxAttempts);

  return outcome === "busy" ? { ok: false, reason: "busy" } : outcome;
}

/**
 * Checks the party in. Each attempt reloads and re-runs the rule, so "ready
 * right now?" is decided on the waitlist the save replaces: two check-ins at
 * the same moment can't both take the same seats.
 */
async function checkInAndSave(
  store: WaitlistStore,
  env: Environment,
  token: string,
): Promise<CheckInOutcome> {
  const outcome = await retryOnConflict(async () => {
    const { waitlist, version } = await store.load();
    const result = checkIn(waitlist, token, env.now());
    if (!result.ok) return result;

    const saved = await store.saveIfVersion(result.waitlist, version);
    if (saved === "conflict") return "conflict";
    return { ok: true as const, party: result.party };
  }, maxAttempts);

  return outcome === "busy" ? { ok: false, reason: "busy" } : outcome;
}

/**
 * Takes the party off the waitlist. Each attempt reloads and re-runs the
 * rule, so leaving is decided on the waitlist the save replaces: a party
 * can't both check in and leave.
 */
async function leaveAndSave(
  store: WaitlistStore,
  env: Environment,
  token: string,
): Promise<LeaveOutcome> {
  const outcome = await retryOnConflict(async () => {
    const { waitlist, version } = await store.load();
    const result = leaveWaitlist(waitlist, token, env.now());
    if (!result.ok) return result;

    const saved = await store.saveIfVersion(result.waitlist, version);
    if (saved === "conflict") return "conflict";
    return { ok: true as const, party: result.party };
  }, maxAttempts);

  return outcome === "busy" ? { ok: false, reason: "busy" } : outcome;
}

/** The party with this token and where it stands right now, if it's there. */
async function findParty(
  store: WaitlistStore,
  env: Environment,
  token: string,
): Promise<{ party: Party; state: PartyState } | undefined> {
  const { waitlist } = await store.load();
  const party = waitlist.parties.find((p) => p.token === token);
  const state = partyState(waitlist, token, env.now());
  return party && state ? { party, state } : undefined;
}

/** How many parties are waiting: what a newcomer would have ahead of them. */
async function waitingCount(
  store: WaitlistStore,
  env: Environment,
): Promise<number> {
  const { waitlist } = await store.load();
  return partiesWaiting(waitlist, env.now());
}

/**
 * The waitlist's use cases, bound to one store and one clock, so the code
 * that calls them (the routes) never handles storage or time itself.
 */
export function waitlistService(store: WaitlistStore, env: Environment) {
  return {
    join: (form: JoinForm) => joinAndSave(store, env, form),
    checkIn: (partyToken: string) => checkInAndSave(store, env, partyToken),
    leave: (partyToken: string) => leaveAndSave(store, env, partyToken),
    find: (partyToken: string) => findParty(store, env, partyToken),
    waitingCount: () => waitingCount(store, env),
    // A fresh join form's key: an unguessable token, like a party's.
    newJoinKey: () => env.newToken(),
    // Loading the waitlist proves MongoDB answers and the waitlist exists.
    checkHealth: async () => {
      await store.load();
    },
  };
}

export type WaitlistService = ReturnType<typeof waitlistService>;
