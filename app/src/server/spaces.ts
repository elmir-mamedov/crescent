/**
 * The spaces home, and what its grid does to a space: create one, rename,
 * archive or delete it, and open its standing instructions.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ArchiveMutation, CreatePageMutation, RenameSpaceMutation } from "../content.js";
import type { Written } from "../kb-writes.js";
import { instructionsSlug } from "../space-instructions.js";
import { notFound, spacesLayout, type ViewNotice } from "../views.js";
import type { ServerContext } from "./context.js";
import { errorMessage, formString, pagePath, queryString } from "./http.js";

export function registerSpaceRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { siteTitle, username, content, writes } = ctx;
  const { renderEditPage } = ctx.render;

  // Home: the spaces landing grid (each top-level folder is a space).
  app.get("/", async (_req, reply) => {
    // Archived spaces too, which the page lists apart from the rest.
    const spaces = await content.spaces("all");
    return reply.type("text/html").send(
      spacesLayout({
        siteTitle: siteTitle,
        spaces,
        username: username,
      })
    );
  });

  app.post("/_create-space", async (req, reply) => {
    const title = formString(req.body, "title") ?? "";
    let written: Written<CreatePageMutation>;
    try {
      written = await writes.createSpace(title);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      return reply
        .code(400)
        .type("text/html")
        .send(
          spacesLayout({
            siteTitle: siteTitle,
            spaces: await content.spaces("all"),
            notice,
            username: username,
          })
        );
    }

    const { mutation, commitError } = written;
    if (commitError) {
      const { html } = await renderEditPage(mutation.slug, {
        error: `Created, but Git commit failed: ${commitError}`,
      });
      return reply.code(500).type("text/html").send(html);
    }

    return reply.redirect(`/_edit${pagePath(mutation.slug)}`, 303);
  });

  // --- Space management from the home grid ---------------------------------
  // The ⋯ menu on each space card posts here. All three actions land back on the
  // spaces home ("/"): the grid is where the user was, and the acted-on space has
  // either changed name, dropped off the live grid (archived), or vanished.

  async function renderSpacesPage(
    reply: FastifyReply,
    status: number,
    extra: { notice?: ViewNotice; confirmDelete?: { key: string; title: string } } = {}
  ): Promise<FastifyReply> {
    return reply
      .code(status)
      .type("text/html")
      .send(
        spacesLayout({
          siteTitle: siteTitle,
          spaces: await content.spaces("all"),
          username: username,
          ...extra,
        })
      );
  }

  // Edit a space's display name in place (its key/URL is stable).
  app.post("/_rename-space", async (req, reply) => {
    const key = formString(req.body, "key") ?? "";
    const title = formString(req.body, "title") ?? "";

    let written: Written<RenameSpaceMutation> | null;
    try {
      written = await writes.renameSpace(key, title);
    } catch (err) {
      return renderSpacesPage(reply, 400, {
        notice: { tone: "error", text: errorMessage(err) },
      });
    }
    if (!written) {
      return renderSpacesPage(reply, 404, {
        notice: { tone: "error", text: `No space named "${key}".` },
      });
    }

    if (written.commitError) {
      return renderSpacesPage(reply, 500, {
        notice: { tone: "error", text: `Renamed, but Git commit failed: ${written.commitError}` },
      });
    }

    return reply.redirect("/", 303);
  });

  // Archive a whole space: marks every page in it archived (reusing the page
  // archive path) so it drops off the live grid but stays restorable.
  app.post("/_archive-space", async (req, reply) => {
    const key = formString(req.body, "key") ?? "";
    if (!key || key.includes("/")) {
      return renderSpacesPage(reply, 400, {
        notice: { tone: "error", text: "Only a top-level space can be archived here." },
      });
    }

    let written: Written<ArchiveMutation> | null;
    try {
      written = await writes.setArchived(key, true);
    } catch (err) {
      return renderSpacesPage(reply, 400, {
        notice: { tone: "error", text: errorMessage(err) },
      });
    }
    if (!written) {
      return renderSpacesPage(reply, 404, {
        notice: { tone: "error", text: `No space named "${key}".` },
      });
    }

    if (written.commitError) {
      return renderSpacesPage(reply, 500, {
        notice: { tone: "error", text: `Archived, but Git commit failed: ${written.commitError}` },
      });
    }

    return reply.redirect("/", 303);
  });

  // Deleting a whole space is irreversible (its git repo goes with it), so the
  // menu's Delete link lands here first for a confirmation prompt.
  app.get("/_delete-space/*", async (req, reply) => {
    const key = content.spaceKeyOf((req.params as { "*": string })["*"] ?? "");
    const space = (await content.spaces("all")).find((s) => s.key === key);
    if (!space) {
      return renderSpacesPage(reply, 404, {
        notice: { tone: "error", text: `No space named "${key}".` },
      });
    }
    return renderSpacesPage(reply, 200, {
      confirmDelete: { key: space.key, title: space.title },
    });
  });

  app.post("/_delete-space/*", async (req, reply) => {
    const key = (req.params as { "*": string })["*"] ?? "";

    let mutation: Awaited<ReturnType<typeof writes.deleteSpace>>;
    try {
      mutation = await writes.deleteSpace(key);
    } catch (err) {
      return renderSpacesPage(reply, 400, {
        notice: { tone: "error", text: errorMessage(err) },
      });
    }
    if (!mutation) {
      return renderSpacesPage(reply, 404, {
        notice: { tone: "error", text: `No space named "${key}".` },
      });
    }

    return reply.redirect("/", 303);
  });

  /**
   * Open a space's standing instructions for editing.
   *
   * The file has to exist before the editor can open it, so this scaffolds an
   * empty one on first visit, commits it, and hands off to the ordinary page
   * editor — `<space>/_instructions` resolves like any other slug, so saving,
   * diffing and auto-commit all work unchanged from there.
   */
  app.get("/_instructions", async (req, reply) => {
    reply.header("cache-control", "no-store");

    const spaceKey = content.spaceKeyOf(queryString(req.query, "space") ?? "");
    if (!spaceKey) return reply.redirect("/", 303);

    // Membership doubles as the traversal guard, as on /_dashboard.
    const space = (await content.spaces("all")).find((s) => s.key === spaceKey);
    if (!space) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, spaceKey, spaces, username));
    }

    try {
      const ensured = await writes.ensureInstructions(space.key);
      if (ensured.commitError) throw new Error(ensured.commitError);
      if (ensured.mutation.created && !ensured.commit) {
        req.log?.warn?.("space instructions scaffolded but nothing to commit");
      }
    } catch (err) {
      const { status, html } = await renderEditPage(instructionsSlug(space.key), {
        error: `Could not open the space instructions: ${errorMessage(err)}`,
      });
      return reply.code(status).type("text/html").send(html);
    }

    return reply.redirect(`/_edit/${instructionsSlug(space.key)}`, 303);
  });
}
