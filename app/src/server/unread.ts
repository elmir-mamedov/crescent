/**
 * Marking a page unread from its ⋯ menu in the sidebar (feedback #12), so a
 * page opened by accident gets its dot back. Fetch-driven, and answers in
 * JSON: the sidebar draws the dot itself, because reloading the page that was
 * marked would open it again.
 */
import type { FastifyInstance } from "fastify";
import { isFolderPage } from "../content.js";
import type { ServerContext } from "./context.js";

export function registerUnreadRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { content, seen } = ctx;

  app.post("/_unread/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    const page = await content.load(slug);
    if (!page) return reply.code(404).send({ ok: false, error: "Page not found." });
    // Only a page is ever new (render.ts): a folder has nothing to read, and a
    // page without an id cannot be tracked.
    const id = page.data.id;
    if (isFolderPage(page.data) || !id) {
      return reply.code(400).send({ ok: false, error: "Only a page can be marked unread." });
    }
    await seen.remove(id);
    return reply.send({ ok: true });
  });
}
