/**
 * Archiving and restoring a page, or a section with everything in it, and a
 * space's archive, which lists its archived pages.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ArchiveMutation, SpaceInfo } from "../content.js";
import type { Written } from "../kb-writes.js";
import { archiveLayout, notFound, type ViewNotice } from "../views.js";
import type { ServerContext } from "./context.js";
import { errorMessage, pagePath } from "./http.js";

export function registerArchiveRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { siteTitle, username, content, writes } = ctx;
  const { dashboardSpace, renderPage, renderSystemNotice, spaceChrome } = ctx.render;

  /**
   * One space's archive: its archived pages, beside its ordinary sidebar. An
   * archived space's own tree is all archived, so its sidebar widens to `all`,
   * as the dashboards do.
   */
  async function renderArchive(space: SpaceInfo): Promise<string> {
    const [spaces, { tree, labelSet }, titles, archiveTree] = await Promise.all([
      content.spaces(),
      spaceChrome(space.key, space.archived ? "all" : "live"),
      content.titleIndex(),
      content.spaceTree(space.key, "archived"),
    ]);

    return archiveLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey: space.key,
      spaceTitle: space.title,
      tree,
      labelSet,
      archiveTree,
      titles,
      username: username,
    });
  }

  // A space's archive, named by ?space= like a dashboard. There is no archive
  // of every space at once (feedback #28): without a space this goes home.
  app.get("/_archive", async (req, reply) => {
    const space = await dashboardSpace(req, reply);
    if (!space) return reply;
    return reply.type("text/html").send(await renderArchive(space));
  });

  async function handleArchiveMutation(
    slug: string,
    archived: boolean,
    reply: FastifyReply
  ) {
    let written: Written<ArchiveMutation> | null;
    try {
      written = await writes.setArchived(slug, archived);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      if (slug.replace(/^\/+|\/+$/g, "") === "") {
        return reply
          .code(400)
          .type("text/html")
          .send(await renderSystemNotice("Archive blocked", notice));
      }

      const { status, html } = await renderPage(slug, {
        notice,
      });
      if (status === 404) {
        return reply
          .code(400)
          .type("text/html")
          .send(await renderSystemNotice("Archive failed", notice));
      }
      return reply.code(400).type("text/html").send(html);
    }

    if (!written) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username));
    }

    const { mutation, commitError } = written;
    if (commitError) {
      const verb = archived ? "Archived" : "Restored";
      const { html } = await renderPage(mutation.slug, {
        notice: {
          tone: "error",
          text: `${verb}, but Git commit failed: ${commitError}`,
        },
      });
      return reply.code(500).type("text/html").send(html);
    }

    return reply.redirect(pagePath(mutation.slug), 303);
  }

  app.post("/_archive", async (_req, reply) => {
    return handleArchiveMutation("", true, reply);
  });

  app.post("/_archive/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    return handleArchiveMutation(slug, true, reply);
  });

  app.post("/_restore", async (_req, reply) => {
    return handleArchiveMutation("", false, reply);
  });

  app.post("/_restore/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    return handleArchiveMutation(slug, false, reply);
  });
}
