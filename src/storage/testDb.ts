// Test helper: each test gets its own fresh collection in the test database,
// dropped afterwards, so tests never see each other's data and never touch
// the development database.
import { randomUUID } from "node:crypto";
import { MongoClient, type Collection, type Document } from "mongodb";
import { afterAll, afterEach } from "vitest";

const client = new MongoClient(
  process.env.MONGO_TEST_URL ?? "mongodb://127.0.0.1:27017/waitlist_test",
);
const drops: (() => Promise<boolean>)[] = [];

// Registered when a test file imports this helper.
afterEach(async () => {
  await Promise.all(drops.splice(0).map((drop) => drop()));
});
afterAll(() => client.close());

export function freshCollection<T extends Document>(): Collection<T> {
  const collection = client.db().collection<T>(`test_${randomUUID()}`);
  drops.push(() => collection.drop());
  return collection;
}
