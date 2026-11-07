/**
 * In-app updates, which only an installed copy has, and /_launch, where
 * KB25's window opens.
 */
import type { FastifyInstance } from "fastify";
import type { Updater } from "../update.js";
import { updateGateLayout } from "../views.js";

export function registerUpdateRoutes(
  app: FastifyInstance,
  { siteTitle, updater }: { siteTitle: string; updater: Updater | null }
): void {
  if (updater) {
    app.get("/_update", async (_req, reply) => reply.send(await updater.status()));
    app.post("/_update", async (_req, reply) => {
      const started = await updater.start();
      if (!started.ok) return reply.code(409).send({ error: started.reason });
      return reply.code(202).send(await updater.status());
    });
    // The person closed the card saying what the update they just had brought.
    app.post("/_update/seen", async (_req, reply) => {
      await updater.seen();
      return reply.code(204).send();
    });
    // Check while the server starts, so the window opening it seldom waits.
    void updater.status();
  }

  // Where KB25's window opens (installer/launcher.mjs). While a newer release is
  // out, an installed copy opens on the update gate instead of the app (feedback
  // issue #21): updates can carry security fixes, so opening KB25 installs them,
  // and only an update that fails lets the person in on this version. A page
  // already open when a release comes out gets the update card instead.
  app.get("/_launch", async (_req, reply) => {
    const status = updater ? await updater.status({ fresh: true }) : null;
    if (!status?.available || !status.latest) return reply.redirect("/", 303);
    return reply
      .header("cache-control", "no-store")
      .type("text/html")
      .send(
        updateGateLayout({
          siteTitle: siteTitle,
          current: status.current,
          latest: status.latest,
          notesUrl: status.notesUrl,
          logFile: status.logFile,
          instance: status.instance,
          updating: status.state === "updating",
        })
      );
  });
}
