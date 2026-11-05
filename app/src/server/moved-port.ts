/**
 * An update that moved KB25 off a dev-server port (installer/setup.mjs) passes
 * the port it left. The page that started the update is still asking that
 * port whether the new version is up, so for a few minutes the old port
 * answers: /_update as this server would, which has the page reload, and the
 * reload with a redirect to the new address. Remove once copies of KB25 0.5.0
 * and earlier have updated.
 */
import Fastify from "fastify";
import { crossSiteRefusal } from "../loopback.js";
import type { Updater } from "../update.js";

export async function forwardMovedPort({
  host,
  port,
  from,
  updater,
}: {
  host: string;
  port: number;
  from: number;
  updater: Updater | null;
}): Promise<void> {
  const forwarder = Fastify({ logger: false });
  forwarder.addHook("onRequest", async (req, reply) => {
    // The same DNS-rebinding guard as this server's: a loopback Host only.
    const refusal = crossSiteRefusal({ method: "GET", host: req.headers.host });
    if (refusal) return reply.code(403).type("text/plain").send(refusal);
  });
  if (updater) {
    forwarder.get("/_update", async (_req, reply) => reply.header("cache-control", "no-store").send(await updater.status()));
  }
  forwarder.get("/*", async (req, reply) => {
    const target = new URL(req.url, `http://${req.headers.host}`);
    target.port = String(port);
    return reply.redirect(target.href, 302);
  });
  try {
    await forwarder.listen({ host, port: from });
    console.log(`Forwarding port ${from}, which KB25 moved from, for 5 minutes`);
    setTimeout(() => void forwarder.close(), 5 * 60_000).unref();
  } catch {
    // Something else took the old port; there is nothing to forward.
  }
}
