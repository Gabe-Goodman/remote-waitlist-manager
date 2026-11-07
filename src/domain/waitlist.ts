// The waitlist's rules: pure functions. No database, no clock, no HTTP;
// the current time and new tokens are passed in.

/** The join form as submitted: every field is text until validated. */
export type JoinForm = { name: string; email: string; size: string };

/** A join form that passed validation, cleaned up. */
export type JoinDetails = { name: string; email: string; size: number };

/** One code per invalid field, so each error can be shown next to its field. */
export type FieldErrors = {
  name?: "required" | "too-long";
  email?: "required" | "too-long" | "invalid";
  size?: "invalid";
};

export type JoinValidation =
  { ok: true; details: JoinDetails } | { ok: false; errors: FieldErrors };

// Long enough for any party name, short enough to fit on the card on a phone.
const maxNameLength = 50;
// No party can be larger than the restaurant's 10 seats.
const maxPartySize = 10;
// The longest address SMTP allows.
const maxEmailLength = 254;

// Deliberately loose: anything shaped like x@y.z. Only a sent email could
// prove an address works, and the app sends none.
const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Digits only: Number() alone would also accept "1e1" or "0x5".
const wholeNumber = /^\d+$/;

export function validateJoin(form: JoinForm): JoinValidation {
  const name = form.name.trim();
  // Lowercased so the same address typed differently counts as one party
  // for the duplicate rule. No provider-specific rules (such as Gmail's
  // dots): merging addresses that actually differ could turn a diner away.
  const email = form.email.trim().toLowerCase();
  const sizeText = form.size.trim();
  const size = Number(sizeText);

  const errors: FieldErrors = {};
  if (name === "") errors.name = "required";
  else if (name.length > maxNameLength) errors.name = "too-long";

  if (email === "") errors.email = "required";
  else if (email.length > maxEmailLength) errors.email = "too-long";
  else if (!emailShape.test(email)) errors.email = "invalid";

  if (!wholeNumber.test(sizeText) || size < 1 || size > maxPartySize)
    errors.size = "invalid";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, details: { name, email, size } };
}

/** A party on the waitlist: only facts, never a stored status. */
export type Party = {
  token: string;
  name: string;
  email: string;
  size: number;
  joinedAt: Date;
};

/** The queue, in order: the first party joined first. */
export type Waitlist = { parties: readonly Party[] };

/** What joining needs from outside the rules: the current time and a new token. */
export type JoinContext = { now: Date; token: string };

export type JoinResult =
  | { ok: true; waitlist: Waitlist; party: Party }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "duplicate" };

/**
 * Validates the form and adds the party at the back of the queue, unless
 * its email is already on the waitlist.
 */
export function join(
  waitlist: Waitlist,
  form: JoinForm,
  context: JoinContext,
): JoinResult {
  const validation = validateJoin(form);
  if (!validation.ok) {
    return { ok: false, reason: "invalid", errors: validation.errors };
  }

  // A party must never appear twice. Every party on the waitlist counts:
  // no party can leave or finish.
  const { email } = validation.details;
  if (waitlist.parties.some((party) => party.email === email)) {
    return { ok: false, reason: "duplicate" };
  }

  const party: Party = {
    token: context.token,
    ...validation.details,
    joinedAt: context.now,
  };
  return {
    ok: true,
    waitlist: { parties: [...waitlist.parties, party] },
    party,
  };
}
