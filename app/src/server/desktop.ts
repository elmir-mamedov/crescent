/**
 * Quitting, for a server a launcher started (KB25_DESKTOP). KB25's window (the
 * native app in shell/) posts ?when=idle to /_quit once it has closed: a chat
 * turn still writing holds that quit until it ends, unless a page is opened
 * again by then. Without it, this is the power button, which quits at once and
 * tells the window, listening on GET /_window, to close too.
 */
import type { FastifyInstance } from "fastify";
import type { Chat } from "../chat.js";

export interface DesktopOptions {
  /** KB25_DESKTOP, on a loopback HOST: without it neither route exists. */
  desktop: boolean;
  chat: Chat;
  /** Stop serving and exit; `closeWindow` closes KB25's window too. */
  shutdown: (reason: string, closeWindow?: boolean) => Promise<void>;
}

/** The windows listening on GET /_window, which a server shutting down lets go. */
export interface Windows {
  /** End every window's stream; `quit` tells each to close first (the Quit button). */
  endAll(quit: boolean): void;
}

export function registerDesktopRoutes(app: FastifyInstance, { desktop, chat, shutdown }: DesktopOptions): Windows {
  let quitWhenChatEnds = false;
  const windows = new Set<NodeJS.WritableStream & { end(): unknown }>();
  chat.onIdle(() => {
    if (quitWhenChatEnds) void shutdown("KB25 window closed");
  });
  if (desktop) {
    app.addHook("onRequest", async (req) => {
      if (quitWhenChatEnds && req.method === "GET" && req.headers["sec-fetch-dest"] === "document") {
        quitWhenChatEnds = false;
      }
    });
    app.post("/_quit", async (req, reply) => {
      const windowClosed = (req.query as { when?: string }).when === "idle";
      if (windowClosed && chat.activeCount() > 0) {
        quitWhenChatEnds = true;
        console.log("KB25 window closed; quitting once the chat reply ends");
      } else {
        reply.raw.once("finish", () =>
          void (windowClosed ? shutdown("KB25 window closed") : shutdown("quit from the page", true))
        );
      }
      return reply.code(202).send({ ok: true });
    });
    // KB25's window listens here for "quit". A restart ends the stream without
    // it, and the window listens again once the new server answers. An update
    // restarts the window as well, from its installer (setup.mjs).
    app.get("/_window", async (_req, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      reply.raw.write(": KB25\n\n");
      windows.add(reply.raw);
      reply.raw.on("close", () => windows.delete(reply.raw));
      // From here the power button reaches it. The release smoke test waits for
      // this line before pressing it (scripts/smoke-installed.mjs).
      console.log("KB25 window connected");
    });
  }

  return {
    endAll(quit) {
      for (const window of windows) {
        try {
          if (quit) window.write("event: quit\ndata: \n\n");
          window.end();
        } catch {}
      }
      windows.clear();
    },
  };
}
