/** The KB's change feed (changes.ts), streamed to the pages open on it. */
import type { FastifyInstance } from "fastify";
import type { ChangeBatch, ChangeFeed } from "../changes.js";

/** The open streams, which a server shutting down ends. */
export interface ChangeStreams {
  endAll(): void;
}

export function registerChangeRoutes(app: FastifyInstance, changes: ChangeFeed): ChangeStreams {
  // The change feed as it happens, for an open page's CHANGES_SCRIPT: first the
  // batches after the page's cursor (EventSource sends the last one it saw as
  // Last-Event-ID when it reconnects), then each new batch.
  const changeStreams = new Set<NodeJS.WritableStream & { end(): unknown }>();
  app.get("/_changes", async (req, reply) => {
    const lastSeen = req.headers["last-event-id"];
    const { since } = req.query as { since?: unknown };
    const cursor = typeof lastSeen === "string" && lastSeen ? lastSeen : typeof since === "string" ? since : "";
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    reply.raw.write("retry: 2000\n\n");
    const send = (batch: ChangeBatch) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`id: ${batch.cursor}\ndata: ${JSON.stringify({ slugs: batch.slugs })}\n\n`);
      }
    };
    for (const batch of changes.since(cursor)) send(batch);
    const unsubscribe = changes.subscribe(send);
    changeStreams.add(reply.raw);
    reply.raw.on("close", () => {
      unsubscribe();
      changeStreams.delete(reply.raw);
    });
  });

  return {
    endAll() {
      for (const stream of changeStreams) {
        try {
          stream.end();
        } catch {}
      }
      changeStreams.clear();
    },
  };
}
