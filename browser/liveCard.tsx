// Keeps the party's card up to date while the page is open, so a diner never
// has to reload. The server renders the card into the page; this component
// takes it over (browser/islands.tsx) and renders the same PartyCard as the
// card's data changes. Without JavaScript the page still shows the right
// state on every load.
//
// TanStack Query does the polling: every 2 seconds, one request at a time,
// at once when the page becomes visible again (a phone taken out of a
// pocket), keeping the card already shown when a fetch fails, and stopping
// once the card can't change any more (done or left). An unchanged answer
// keeps the same object, so React re-renders only when the card changed, and
// then changes only what differs: an open "Leave the waitlist" stays open.
import { useQuery, type QueryState } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { PartyState } from "../src/domain/waitlist.js";
import { cardTitles } from "../src/views/messages.js";
import { PartyCard, type CardData } from "../src/views/partyCard.js";

const pollEvery = 2000;

async function fetchCard(token: string): Promise<CardData> {
  const response = await fetch(`/party/${token}/card.json`);
  // 204 (no such party) counts as a failure too: the card stays as it is.
  if (response.status !== 200) {
    throw new Error(`card.json answered ${response.status}`);
  }
  return (await response.json()) as CardData;
}

// Whether there's still anything to poll for: done and left are final.
function canChange({ data }: QueryState<CardData>) {
  return data?.state.kind !== "done" && data?.state.kind !== "left";
}

export function LiveCard({ initial }: { initial: CardData }) {
  const { data: card } = useQuery({
    queryKey: ["card", initial.party.token],
    queryFn: () => fetchCard(initial.party.token),
    // The card the server rendered, so the first render matches its HTML.
    initialData: initial,
    refetchInterval: (query) => (canChange(query.state) ? pollEvery : false),
    // A diner waiting in another tab still sees the title change.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: (query) => canChange(query.state),
  });
  useAttentionSignals(card.state);
  return <PartyCard {...card} />;
}

// The tab shows the card's title, so a diner in another tab sees the table
// is ready; the phone vibrates when it becomes ready.
function useAttentionSignals(state: PartyState) {
  const previous = useRef(state.kind);
  useEffect(() => {
    document.title = cardTitles[state.kind];
    if (state.kind === "ready" && previous.current !== "ready") vibrate();
    previous.current = state.kind;
  }, [state.kind]);
}

// Browsers allow vibration only after the diner has tapped the page, and
// iPhones don't vibrate at all; the card and the title still change.
function vibrate() {
  try {
    navigator.vibrate?.(200);
  } catch {
    // Nothing to do: the card and the title are the main signal.
  }
}
