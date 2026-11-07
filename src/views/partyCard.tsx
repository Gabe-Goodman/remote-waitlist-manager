// The party's current state. For now: its name, size and place in the queue.
import type { PartyPlace } from "../domain/waitlist.js";
import { messages } from "./messages.js";

export function PartyCard({ place }: { place: PartyPlace }) {
  return (
    <section className="card">
      <h1>{messages.onWaitlistTitle}</h1>
      <p>
        <strong>{place.party.name}</strong> ·{" "}
        {messages.partyOf(place.party.size)}
      </p>
      <p className="ahead">{messages.ahead(place.ahead)}</p>
    </section>
  );
}
