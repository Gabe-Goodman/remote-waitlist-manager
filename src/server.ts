// Starts the app: reads settings, connects to MongoDB, creates the waitlist
// if it's missing, mounts the routes, and shuts down cleanly. Wiring only:
// no rules and no request handling.
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { waitlistRoutes } from "./routes/waitlistRoutes.js";
import { waitlistService } from "./services/waitlistService.js";
import {
  waitlistStore,
  type WaitlistDocument,
} from "./storage/waitlistStore.js";

const port = Number(process.env.PORT ?? 3000);
const mongoUrl = process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017/waitlist";

// Without this, a page waits about 30 s (the driver's default) before the
// error page appears when MongoDB is down; 5 s is long enough for a healthy
// server to answer and short enough for a diner to wait.
const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
// Connect before listening, so a wrong MONGO_URL stops the app at startup
// instead of failing the first diner's request.
await client.connect();
const db = client.db();
const store = waitlistStore(db.collection<WaitlistDocument>("waitlist"));
await store.ensureExists();

// The real clock and real tokens; tests pass their own.
const env = {
  now: () => new Date(),
  // 128 random bits: a party's token is the key to its party, so it must not
  // be guessable.
  newToken: () => randomBytes(16).toString("base64url"),
};

const app = new Hono();
app.route("/", waitlistRoutes(waitlistService(store, env)));

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

// Docker stops a container with SIGTERM. Node running as the container's
// main process ignores it unless handled, so Docker would wait 10 s and
// kill it. Instead: stop accepting requests, let in-flight ones finish,
// then close the database connection.
process.on("SIGTERM", () => {
  server.close(() => void client.close());
});
