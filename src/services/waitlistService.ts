// Use cases only: load the waitlist, apply a rule, save if nobody saved in
// between, retry on conflict. No HTTP and no MongoDB queries here.
import { setTimeout as sleep } from "node:timers/promises";
import {
  join,
  partiesWaiting,
  partyPlace,
  type FieldErrors,
  type JoinForm,
  type Party,
  type PartyPlace,
} from "../domain/waitlist.js";
import type { WaitlistStore } from "../storage/waitlistStore.js";

/** The outside world a use case needs: the clock and new tokens. */
export type Environment = { now(): Date; newToken(): string };

export type JoinOutcome =
  | { ok: true; party: Party }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "duplicate" }
  | { ok: false; reason: "busy" };

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

// Enough for a burst of simultaneous joins; past it, the join ends as busy
// rather than retrying forever.
const maxAttempts = 10;

/**
 * Adds a party to the waitlist. Each attempt reloads and re-runs the rule,
 * so a duplicate that slipped in during a conflict is still caught.
 */
export async function joinWaitlist(
  store: WaitlistStore,
  env: Environment,
  form: JoinForm,
): Promise<JoinOutcome> {
  const outcome = await retryOnConflict(async () => {
    const { waitlist, version } = await store.load();
    const context = { now: env.now(), token: env.newToken() };
    const result = join(waitlist, form, context);
    if (!result.ok) return result;

    const saved = await store.saveIfVersion(result.waitlist, version);
    if (saved === "conflict") return "conflict";
    return { ok: true as const, party: result.party };
  }, maxAttempts);

  return outcome === "busy" ? { ok: false, reason: "busy" } : outcome;
}

/** The party with this token and its place in the queue, if it's there. */
export async function findParty(
  store: WaitlistStore,
  token: string,
): Promise<PartyPlace | undefined> {
  const { waitlist } = await store.load();
  return partyPlace(waitlist, token);
}

/** How many parties are waiting: what a newcomer would have ahead of them. */
export async function waitingCount(store: WaitlistStore): Promise<number> {
  const { waitlist } = await store.load();
  return partiesWaiting(waitlist);
}
