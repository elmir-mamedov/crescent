/**
 * A page's HTML widgets (views/widgets.ts), at `/_embed/<space>/_assets/*`:
 * the one route that sends a space's HTML as a page rather than a download,
 * and only as the sandboxed, offline document a page's frame shows
 * (`embedHeaders`). `/<space>/_assets/x.html` itself stays a download.
 */
import { promises as fs } from "node:fs";
import type { FastifyInstance } from "fastify";
import { embedHeaders, isWidgetName } from "../assets.js";
import { widgetDocument } from "../views/widgets.js";
import type { ServerContext } from "./context.js";

/**
 * The biggest widget sent. A widget is read whole to put the preamble in
 * front of it, so one copied in by hand, at any size, must not be.
 */
export const WIDGET_SIZE_LIMIT = 5 * 1024 * 1024;

export function registerWidgetRoutes(app: FastifyInstance, { content }: Pick<ServerContext, "content">): void {
  app.get("/_embed/:space/_assets/*", async (req, reply) => {
    const params = req.params as { space: string; "*": string };
    if (!isWidgetName(params["*"])) return reply.callNotFound();
    // Refuses dotfiles and anything reached through a symbolic link, as the
    // asset route does.
    const fsPath = await content.resolveAsset(params.space, params["*"]);
    if (!fsPath) return reply.callNotFound();
    const { size } = await fs.stat(fsPath);
    if (size > WIDGET_SIZE_LIMIT) {
      return reply.code(413).type("text/plain; charset=utf-8").send("This widget is too big to show.");
    }
    return reply.headers(embedHeaders()).send(widgetDocument(await fs.readFile(fsPath, "utf8")));
  });
}
