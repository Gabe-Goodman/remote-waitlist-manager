// MongoDB only: the whole waitlist lives in one document. No rules here.
import type { Collection } from "mongodb";
import type { Party, Waitlist } from "../domain/waitlist.js";

export type WaitlistDocument = {
  _id: "main";
  version: number;
  parties: Party[];
};

export type WaitlistStore = ReturnType<typeof waitlistStore>;

export function waitlistStore(collection: Collection<WaitlistDocument>) {
  return {
    async ensureExists(): Promise<void> {
      // $setOnInsert with upsert: only writes when no document exists, so
      // restarting the app can never reset a waitlist in progress.
      await collection.updateOne(
        { _id: "main" },
        { $setOnInsert: { version: 0, parties: [] } },
        { upsert: true },
      );
    },

    async load(): Promise<{ waitlist: Waitlist; version: number }> {
      const found = await collection.findOne({ _id: "main" });
      if (found === null) {
        // Throws rather than returning an empty waitlist: without the
        // document, every save would quietly fail as a conflict.
        // ensureExists() runs at startup.
        throw new Error("No waitlist document: call ensureExists() first");
      }
      return { waitlist: { parties: found.parties }, version: found.version };
    },

    async saveIfVersion(
      waitlist: Waitlist,
      version: number,
    ): Promise<"saved" | "conflict"> {
      // The version in the filter makes this "save only if nobody saved in
      // between": if another request saved since this waitlist was loaded,
      // nothing matches, nothing is written, and the result is "conflict".
      // Without it, the later save would silently overwrite the earlier one.
      // No upsert: the document always exists, and an upsert would turn a
      // stale save into an attempt to insert a second "main".
      const result = await collection.replaceOne(
        { _id: "main", version },
        { version: version + 1, parties: [...waitlist.parties] },
      );
      return result.matchedCount === 1 ? "saved" : "conflict";
    },
  };
}
