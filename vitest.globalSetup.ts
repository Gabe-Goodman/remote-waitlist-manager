// Builds the browser's script once before the tests: the party page links
// it, with a hash of its content in the address, and the route tests check
// it's served.
import { build } from "vite";

export default async function buildIslands() {
  await build({ logLevel: "warn" });
}
