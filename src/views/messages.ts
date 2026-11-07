// Every word a diner reads, in one place, so wording changes never touch
// the rules or the routes.
import {
  maxEmailLength,
  maxNameLength,
  type FieldErrors,
} from "../domain/waitlist.js";

export const messages = {
  joinTitle: "Join the waitlist",
  joinIntro: "Leave your details and keep this page open to see your place.",
  nameLabel: "Name",
  emailLabel: "Email",
  sizeLabel: "Party size",
  sizePlaceholder: "Choose…",
  joinButton: "Join the waitlist",
  // A count only, never names: who else is waiting is nobody's business.
  waiting: (count: number) =>
    count === 0
      ? "No one is waiting right now."
      : count === 1
        ? "1 party is waiting."
        : `${count} parties are waiting.`,
  onWaitlistTitle: "You're on the waitlist",
  partyOf: (size: number) => `Party of ${size}`,
  ahead: (count: number) =>
    count === 0
      ? "No parties ahead of you."
      : count === 1
        ? "1 party ahead of you."
        : `${count} parties ahead of you.`,
  errorTitle: "Something went wrong",
  tryAgain: "Try again",
} as const;

/** Form-level notices, shown in the box at the top of the form. */
export type Notice = "fix-fields" | "duplicate" | "busy";

export const noticeMessages: Record<Notice, string> = {
  "fix-fields": "Please fix the highlighted fields below.",
  duplicate: "A party with this email is already on the waitlist.",
  busy: "Lots of people are joining right now. Please tap Join again.",
};

// One message for every error code the domain can return: a new code
// without wording here is a type error.
type FieldErrorMessages = {
  [Field in keyof FieldErrors]-?: Record<
    NonNullable<FieldErrors[Field]>,
    string
  >;
};

export const fieldErrorMessages: FieldErrorMessages = {
  name: {
    required: "Please enter a name for your party.",
    "too-long": `Please keep the name to ${maxNameLength} characters or fewer.`,
  },
  email: {
    required: "Please enter your email address.",
    "too-long": `Please keep the email to ${maxEmailLength} characters or fewer.`,
    invalid: "Please enter an email address like name@example.com.",
  },
  size: {
    invalid: "Please choose your party size.",
  },
};
