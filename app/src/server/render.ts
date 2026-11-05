/**
 * What several route modules draw: a page or folder, a page's editor, a
 * notice standing in for a page, and the sidebar around each of them.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isFolderPage, type PageNode, type SpaceInfo, type TreeFilter } from "../content.js";
import { cleanLabelNames } from "../frontmatter.js";
import { loadLabelSet, type LabelDef } from "../labels.js";
import { createRenderer, noteSegments, type Section } from "../markdown.js";
import { parseNotes } from "../notes.js";
import { CHAR_CAP, isInstructionsSlug } from "../space-instructions.js";
import { editLayout, escapeHtml, folderLayout, layout, notFound, type ViewNotice } from "../views.js";
import type { Site } from "./context.js";
import { queryString } from "./http.js";

const execFileAsync = promisify(execFile);

export type Render = ReturnType<typeof makeRender>;

/**
 * A folder has nothing to read, so only a page can be fresh; a closed folder
 * still shows a ring when a fresh page is inside it. A page without an id
 * predates the id backfill and cannot be tracked.
 */
function markFresh(nodes: PageNode[], seenIds: ReadonlySet<string>): void {
  for (const n of nodes) {
    if (!n.isFolder && n.id && !seenIds.has(n.id)) n.fresh = true;
    markFresh(n.children, seenIds);
  }
}

/** Depth-first search for a node by slug within a (possibly nested) tree. */
function findNode(nodes: PageNode[], slug: string): PageNode | null {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    const hit = findNode(n.children, slug);
    if (hit) return hit;
  }
  return null;
}

export function makeRender({ siteTitle, username, content, git, seen }: Site) {
  /**
   * The space a key names, or null. Membership in the space list doubles as the
   * traversal guard: spaceKeyOf("../etc") yields "..", which is not a space.
   */
  async function findSpace(key: string): Promise<SpaceInfo | null> {
    const clean = content.spaceKeyOf(key);
    if (!clean) return null;
    return (await content.spaces("all")).find((s) => s.key === clean) ?? null;
  }

  /**
   * What every page with a sidebar draws around its content in one space: the
   * navigation tree, with the pages nobody has opened yet marked fresh, and the
   * label palette its search filter and label dialog offer.
   */
  async function spaceChrome(
    spaceKey: string,
    filter: TreeFilter = "live"
  ): Promise<{ tree: PageNode[]; labelSet: LabelDef[] }> {
    const [tree, labelSet, seenIds] = await Promise.all([
      content.spaceTree(spaceKey, filter),
      loadLabelSet(content, spaceKey),
      seen.ids(),
    ]);
    markFresh(tree, seenIds);
    return { tree, labelSet };
  }

  /**
   * Opening a page, or its editor, is what clears its fresh mark. The tree passed
   * in is the one about to be drawn around the page, so it is updated too and
   * the sidebar already shows the page as seen.
   */
  async function markVisited(tree: PageNode[], slug: string): Promise<void> {
    const node = findNode(tree, slug);
    if (!node?.fresh || !node.id) return;
    node.fresh = false;
    await seen.add(node.id);
  }

  /** Best-effort git commit date+time for a file; falls back to null. */
  async function gitUpdated(fsPath: string): Promise<string | null> {
    if (!(await git.hasGit())) return null;
    try {
      // History lives in the file's per-space repo, not at the KB root.
      const repoRoot = git.spaceRepoRoot(fsPath);
      const rel = path.relative(repoRoot, fsPath);
      const { stdout } = await execFileAsync(
        "git",
        ["log", "-1", "--date=format:%Y-%m-%d %H:%M", "--format=%cd", "--", rel],
        { cwd: repoRoot }
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async function renderPage(
    slug: string,
    options: { notice?: ViewNotice } = {}
  ): Promise<{ status: number; html: string }> {
    const [spaces, titles, ids, page] = await Promise.all([
      content.spaces(),
      content.titleIndex(),
      content.idIndex(),
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
    await markVisited(tree, page.slug);

    // A folder is a pure container: render its contents listing, never prose.
    if (isFolderPage(page.data)) {
      const node = findNode(tree, page.slug);
      const html = folderLayout({
        siteTitle: siteTitle,
        spaces,
        spaceKey,
        tree,
        labelSet,
        activeSlug: page.slug,
        titles,
        title: page.data.title,
        children: node?.children ?? [],
        isArchived: page.data.archived === true,
        archivedAt: page.data.archivedAt,
        notice: options.notice,
        username: username,
      });
      return { status: 200, html };
    }

    const md = createRenderer((s) => titles.get(s), page.slug, (id) => ids.get(id));
    // The renderer parks the page's headings on `env` as it goes, so the rail and
    // the HTML it indexes come out of one pass and cannot disagree.
    const env: Record<string, unknown> = {};
    const contentHtml = md.render(page.body, env);
    const updated = await gitUpdated(page.fsPath);
    // The renderer stamps each note's id onto the block it belongs to; the client
    // needs the notes themselves to draw them. A note's own words can carry links
    // — a wiki-link to the page that answers it is the common one — so they are
    // resolved here, through the page's own renderer, and shipped as segments the
    // client can turn into anchors without ever handling markup.
    const notes = parseNotes(page.body).map((note) => {
      const segments = noteSegments(md, note.text, spaceKey);
      return segments.some((segment) => segment.href) ? { ...note, segments } : note;
    });
    // The rail lists h2 and h3. Deeper headings are still linkable — they get an
    // id and a copy affordance like every other — but listing them turns the rail
    // into a second copy of the page. An h1 in the body just repeats the title
    // already standing above it.
    const sections = ((env.kb25Sections as Section[] | undefined) ?? []).filter(
      (s) => s.level === 2 || s.level === 3
    );

    const html = layout({
      siteTitle: siteTitle,
      spaces,
      spaceKey,
      tree,
      labelSet,
      activeSlug: page.slug,
      titles,
      title: page.data.title,
      labels: cleanLabelNames(page.data.labels ?? []),
      tags: page.data.tags,
      contentHtml,
      sections,
      notes,
      updated,
      isArchived: page.data.archived === true,
      archivedAt: page.data.archivedAt,
      notice: options.notice,
      username: username,
    });
    return { status: 200, html };
  }

  async function renderSystemNotice(title: string, notice: ViewNotice): Promise<string> {
    const [spaces, titles] = await Promise.all([content.spaces(), content.titleIndex()]);
    return layout({
      siteTitle: siteTitle,
      spaces,
      spaceKey: "",
      tree: [],
      activeSlug: "",
      titles,
      title,
      contentHtml: `<p>${escapeHtml(notice.text)}</p>`,
      canEdit: false,
      notice,
      username: username,
    });
  }

  async function renderEditPage(
    slug: string,
    options: { raw?: string; error?: string; notice?: string } = {}
  ): Promise<{ status: number; html: string }> {
    const [spaces, titles, page] = await Promise.all([
      content.spaces(),
      content.titleIndex(),
      content.loadRaw(slug),
    ]);

    if (!page) {
      return {
        status: 404,
        html: notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username),
      };
    }

    const spaceKey = content.spaceKeyOf(page.slug);
    const { tree, labelSet } = await spaceChrome(spaceKey);
    await markVisited(tree, page.slug);
    const fallbackTitle = page.slug.split("/").pop() || "Home";

    // A space's instructions file is deliberately absent from the title index (the
    // tree walk skips `_`-prefixed entries), so name it here rather than falling
    // back to the raw "_instructions" leaf.
    const isInstructions = isInstructionsSlug(page.slug);
    const spaceTitle = spaces.find((s) => s.key === spaceKey)?.title ?? spaceKey;

    const html = editLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey,
      tree,
      labelSet,
      activeSlug: page.slug,
      titles,
      title: isInstructions
        ? `${spaceTitle} instructions`
        : titles.get(page.slug) ?? fallbackTitle,
      raw: options.raw ?? page.raw,
      error: options.error,
      notice: options.notice,
      username: username,
      instructions: isInstructions ? { cap: CHAR_CAP, spaceTitle } : undefined,
    });
    return { status: options.error ? 400 : 200, html };
  }

  /**
   * Every dashboard reports on one space, named by `?space=`. The corner button
   * only appears while a space is active and carries its key, so a request
   * without one was typed by hand: send it to the space picker rather than
   * guessing. Null means the reply has already been sent.
   */
  async function dashboardSpace(req: FastifyRequest, reply: FastifyReply): Promise<SpaceInfo | null> {
    // Derived from authenticated content and stale the moment a page changes.
    reply.header("cache-control", "no-store");

    const spaceKey = content.spaceKeyOf(queryString(req.query, "space") ?? "");
    if (!spaceKey) {
      reply.redirect("/", 303);
      return null;
    }
    const space = await findSpace(spaceKey);
    if (!space) {
      const spaces = await content.spaces();
      reply.code(404).type("text/html").send(notFound(siteTitle, spaceKey, spaces, username));
      return null;
    }
    return space;
  }

  return { findSpace, spaceChrome, renderPage, renderSystemNotice, renderEditPage, dashboardSpace };
}
