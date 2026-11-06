// Starts the app: reads settings, connects to MongoDB, mounts the routes,
// and shuts down cleanly. Wiring only: no rules and no request handling.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { waitlistRoutes } from "./routes/waitlistRoutes.js";

const port = Number(process.env.PORT ?? 3000);
const mongoUrl = process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017/waitlist";

const client = new MongoClient(mongoUrl);
// Connect before listening, so a wrong MONGO_URL stops the app at startup
// instead of failing the first diner's request.
await client.connect();
const db = client.db();

const app = new Hono();
app.route(
  "/",
  waitlistRoutes(async () => {
    await db.command({ ping: 1 });
  }),
);

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
