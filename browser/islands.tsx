// The party page's script, built by Vite into dist/browser/islands.js. The
// server has already rendered the card; this takes it over (hydrates it)
// from the data it was rendered from, so the Copy button and the live card
// work. Every page works without it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateRoot } from "react-dom/client";
import type { CardData } from "../src/views/partyCard.js";
import { LiveCard } from "./liveCard.js";

const root = document.getElementById("party-card");
if (root?.dataset.card) {
  const initial = JSON.parse(root.dataset.card) as CardData;
  hydrateRoot(
    root,
    <QueryClientProvider client={new QueryClient()}>
      <LiveCard initial={initial} />
    </QueryClientProvider>,
  );
}
