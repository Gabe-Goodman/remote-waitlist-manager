// The party's current state. For now: its place in the queue, its name and
// its size.
import type { PartyPlace } from "../domain/waitlist.js";
import { messages } from "./messages.js";

export function PartyCard({ place }: { place: PartyPlace }) {
  return (
    <section className="card">
      <h1>{messages.onWaitlistTitle}</h1>
      {/* Where you stand comes first and largest: it's what a diner looks
          for every time they glance at their phone. */}
      <div className="place">
        <p className="ahead">{messages.ahead(place.ahead)}</p>
        <p>{messages.partyLine(place.party.name, place.party.size)}</p>
      </div>
    </section>
  );
}
