/**
 * Download ▸ Website (site-export.ts): a page and every page under it, or a
 * whole space, as a zip of static HTML, at `/_site/<slug>`.
 */
import type { FastifyInstance } from "fastify";
import { exportSite } from "../site-export.js";
import { attachment } from "./http.js";
import { notFound } from "../views.js";
import type { ServerContext } from "./context.js";

export function registerSiteExportRoutes(
  app: FastifyInstance,
  { content, siteTitle, username }: Pick<ServerContext, "content" | "siteTitle" | "username">,
  appDir: string
): void {
  app.get("/_site/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    const site = await exportSite(content, slug, appDir);
    if (!site) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username));
    }
    return reply
      .header("content-disposition", attachment(site.filename))
      .type("application/zip")
      .send(site.body);
  });
}
