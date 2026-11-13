/**
 * A page's own routes: reading it (any path no other route claims), adding a
 * page or folder, renaming a folder, editing, downloading the Markdown, the
 * edit history, and deleting.
 */
import type { FastifyInstance } from "fastify";
import { isFolderPage, type CreatePageMutation, type DeleteMutation } from "../content.js";
import { downloadFilename, downloadMarkdown } from "../page-export.js";
import { parseWordDiff } from "../diff.js";
import type { PageSave, Written } from "../kb-writes.js";
import { deleteLayout, diffLayout, notFound, type ViewNotice } from "../views.js";
import type { ServerContext } from "./context.js";
import { errorMessage, formString, pagePath, queryString } from "./http.js";

export function registerPageRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { siteTitle, username, content, git, writes } = ctx;
  const { renderEditPage, renderPage, renderSystemNotice, spaceChrome } = ctx.render;

  /** True when the slug resolves to a folder (a pure container with no body). */
  async function slugIsFolder(slug: string): Promise<boolean> {
    const page = await content.load(slug);
    return page ? isFolderPage(page.data) : false;
  }

  async function renderDiffPage(
    slug: string,
    revIndex: number
  ): Promise<{ status: number; html: string }> {
    const [spaces, titles, page] = await Promise.all([
      content.spaces(),
      content.titleIndex(),
      content.load(slug),
    ]);

    if (!page) {
      return {
        status: 404,
        html: notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username),
      };
    }

    const spaceKey = content.spaceKeyOf(page.slug);
    const { tree, labelSet } = await spaceChrome(spaceKey);

    const commits = await git.fileCommits(page.fsPath);
    // Clamp the requested revision into range; 0 is the latest edit.
    const clamped = commits.length
      ? Math.min(Math.max(revIndex, 0), commits.length - 1)
      : 0;
    const commit = commits[clamped];
    const lines = commit
      ? parseWordDiff(await git.showWordDiff(page.fsPath, commit.sha, commit.pathAtCommit))
      : [];

    const html = diffLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey,
      tree,
      labelSet,
      activeSlug: page.slug,
      titles,
      title: page.data.title,
      commitCount: commits.length,
      revIndex: clamped,
      revDate: commit?.date ?? null,
      revSubject: commit?.subject ?? null,
      lines,
      username: username,
    });
    return { status: 200, html };
  }

  async function renderDeletePage(slug: string): Promise<{ status: number; html: string }> {
    const [spaces, titles, preview] = await Promise.all([
      content.spaces(),
      content.titleIndex(),
      content.deletePreview(slug),
    ]);

    if (!preview) {
      return {
        status: 404,
        html: notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username),
      };
    }

    const spaceKey = content.spaceKeyOf(preview.slug);
    const { tree, labelSet } = await spaceChrome(spaceKey);
    return {
      status: 200,
      html: deleteLayout({
        siteTitle: siteTitle,
        spaces,
        spaceKey,
        tree,
        labelSet,
        activeSlug: preview.slug,
        titles,
        title: preview.title,
        fsPath: preview.fsPath,
        isSection: preview.isSection,
        affectedCount: preview.affectedFsPaths.length,
        username: username,
      }),
    };
  }

  app.post("/_create", async (req, reply) => {
    const parentSlug = formString(req.body, "parentSlug") ?? "";
    let written: Written<CreatePageMutation>;
    try {
      written = await writes.createDraft(parentSlug);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      return reply
        .code(500)
        .type("text/html")
        .send(await renderSystemNotice("Create failed", notice));
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

  app.post("/_create-folder", async (req, reply) => {
    const parentSlug = formString(req.body, "parentSlug") ?? "";
    const name = formString(req.body, "name") ?? "";
    let written: Written<CreatePageMutation>;
    try {
      // A folder is created with its name up front; there is nothing to edit
      // afterwards, so we land on its listing rather than the markdown editor.
      written = await writes.createFolder(parentSlug, name);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      return reply
        .code(500)
        .type("text/html")
        .send(await renderSystemNotice("Create failed", notice));
    }

    const { mutation, commitError } = written;
    if (commitError) {
      const notice = {
        tone: "error",
        text: `Created, but Git commit failed: ${commitError}`,
      } satisfies ViewNotice;
      const { html } = await renderPage(mutation.slug, { notice });
      return reply.code(500).type("text/html").send(html);
    }

    return reply.redirect(pagePath(mutation.slug), 303);
  });

  // Rename a folder's display name in place (its URL slug does not change).
  app.post("/_rename-folder", async (req, reply) => {
    const slug = formString(req.body, "slug") ?? "";
    const name = formString(req.body, "name") ?? "";

    let written: Awaited<ReturnType<typeof writes.renameFolder>>;
    try {
      written = await writes.renameFolder(slug, name);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      const { html } = await renderPage(slug, { notice });
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
      const notice = {
        tone: "error",
        text: `Renamed, but Git commit failed: ${commitError}`,
      } satisfies ViewNotice;
      const { html } = await renderPage(mutation.slug, { notice });
      return reply.code(500).type("text/html").send(html);
    }

    return reply.redirect(pagePath(mutation.slug), 303);
  });

  app.get("/_edit/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    // Folders have no editable body — send the user to the folder listing.
    if (await slugIsFolder(slug)) return reply.redirect(pagePath(slug), 303);
    const { status, html } = await renderEditPage(slug);
    return reply.code(status).type("text/html").send(html);
  });

  app.post("/_edit/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    if (await slugIsFolder(slug)) return reply.redirect(pagePath(slug), 303);
    const markdown = formString(req.body, "markdown");
    if (markdown === null) {
      const { status, html } = await renderEditPage(slug, {
        error: "Missing markdown form field.",
      });
      return reply.code(status).type("text/html").send(html);
    }

    // An optional URL-slug change, made once the content is saved.
    const newLeaf = formString(req.body, "slug")?.trim();
    let written: Written<PageSave> | null;
    try {
      written = await writes.savePage(slug, markdown, newLeaf);
    } catch (err) {
      const { html } = await renderEditPage(slug, {
        raw: markdown,
        error: `Could not save page: ${errorMessage(err)}`,
      });
      return reply.code(400).type("text/html").send(html);
    }

    if (!written) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username));
    }

    const { page, renamed, renameError } = written.mutation;
    if (renameError) {
      const { html } = await renderEditPage(page.slug, {
        raw: markdown,
        error: `Saved the content, but could not change the URL: ${renameError}`,
      });
      return reply.code(400).type("text/html").send(html);
    }

    const savedSlug = renamed ? renamed.newSlug : page.slug;
    if (written.commitError) {
      const { html } = await renderEditPage(savedSlug, {
        raw: markdown,
        error: `Saved, but Git commit failed: ${written.commitError}`,
      });
      return reply.code(500).type("text/html").send(html);
    }

    return reply.redirect(pagePath(savedSlug));
  });

  // Download a page's Markdown as an attachment, without its metadata.
  app.get("/_download/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    // A folder is a pure container — there is no document to download.
    if (await slugIsFolder(slug)) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username));
    }
    const page = await content.loadRaw(slug);
    if (!page) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username));
    }
    return reply
      .header(
        "content-disposition",
        `attachment; filename="${downloadFilename(page.slug)}"`
      )
      .type("text/markdown; charset=utf-8")
      .send(downloadMarkdown(page.raw));
  });

  // Word-level diff of a page's edit history; ?rev=N steps back (0 = latest edit).
  app.get("/_diff/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    // A folder is a pure container — there is no prose to diff.
    if (await slugIsFolder(slug)) return reply.redirect(pagePath(slug), 303);
    const revRaw = queryString(req.query, "rev");
    const parsed = revRaw === null ? 0 : Number.parseInt(revRaw, 10);
    const revIndex = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const { status, html } = await renderDiffPage(slug, revIndex);
    return reply.code(status).type("text/html").send(html);
  });

  app.get("/_delete", async (_req, reply) => {
    const notice = {
      tone: "error",
      text: "The home page cannot be deleted.",
    } satisfies ViewNotice;
    return reply
      .code(400)
      .type("text/html")
      .send(await renderSystemNotice("Delete blocked", notice));
  });

  app.get("/_delete/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    try {
      const { status, html } = await renderDeletePage(slug);
      return reply.code(status).type("text/html").send(html);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      return reply
        .code(400)
        .type("text/html")
        .send(await renderSystemNotice("Delete blocked", notice));
    }
  });

  app.post("/_delete", async (_req, reply) => {
    const notice = {
      tone: "error",
      text: "The home page cannot be deleted.",
    } satisfies ViewNotice;
    return reply
      .code(400)
      .type("text/html")
      .send(await renderSystemNotice("Delete blocked", notice));
  });

  app.post("/_delete/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    let written: Written<DeleteMutation> | null;

    try {
      written = await writes.deletePage(slug);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      return reply
        .code(400)
        .type("text/html")
        .send(await renderSystemNotice("Delete blocked", notice));
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
      const notice = {
        tone: "error",
        text: `Deleted, but Git commit failed: ${commitError}`,
      } satisfies ViewNotice;
      return reply
        .code(500)
        .type("text/html")
        .send(await renderSystemNotice("Delete commit failed", notice));
    }

    // Land on the nearest surviving ancestor (parent page or space) rather than
    // bouncing all the way out to the spaces home.
    let destination = "/";
    let ancestor = mutation.slug.split("/").slice(0, -1).join("/");
    while (ancestor) {
      if (await content.resolve(ancestor)) {
        destination = pagePath(ancestor);
        break;
      }
      ancestor = ancestor.split("/").slice(0, -1).join("/");
    }
    return reply.redirect(destination, 303);
  });

  // Any page by slug (supports nested paths).
  app.get("/*", async (req, reply) => {
    const slug = (req.params as { "*": string })["*"] ?? "";
    const { status, html } = await renderPage(slug);
    return reply.code(status).type("text/html").send(html);
  });
}
