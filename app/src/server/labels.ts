/**
 * Labels: setting a page's from the sidebar's label dialog, managing a
 * space's, and the Labels view, which lists or searches the pages carrying
 * the labels ticked.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SpaceInfo } from "../content.js";
import { cleanLabelNames, labelKey } from "../frontmatter.js";
import type { Written } from "../kb-writes.js";
import { filterLabelled, knownLabels, spaceNodes, type LabelMutation } from "../labels.js";
import { mapWithConcurrency, searchPages, searchTokens } from "../search.js";
import { labelsDashboardLayout, labelsHref, notFound, type LabelResult, type ViewNotice } from "../views.js";
import type { ServerContext } from "./context.js";
import {
  errorMessage,
  formString,
  formStrings,
  pagePath,
  queryString,
  queryStrings,
  safeRedirectPath,
} from "./http.js";

// The Labels view. A filter of more labels than this matches nothing useful
// and only makes the URL a lever for work; a search there lists more than the
// type-ahead because it is the page a person reads results on.
export const LABEL_FILTER_MAX = 10;
export const LABELS_SEARCH_LIMIT = 50;

export function registerLabelRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { siteTitle, username, content, writes } = ctx;
  const { dashboardSpace, findSpace, renderPage, spaceChrome } = ctx.render;

  /**
   * The Labels view for one space. With a query it is a search narrowed to the
   * ticked labels, ranked like the sidebar's; without one it lists every page
   * carrying them, in navigation order, each with its summary.
   */
  async function renderLabelsDashboard(
    space: SpaceInfo,
    selected: string[],
    query: string,
    notice?: ViewNotice
  ): Promise<string> {
    const filter = space.archived ? "all" : "live";
    const [spaces, { tree, labelSet }, titles, nodes] = await Promise.all([
      content.spaces(),
      spaceChrome(space.key, filter),
      content.titleIndex(),
      spaceNodes(content, space.key, filter),
    ]);

    // A label named in the URL that no page carries any more still shows as a
    // ticked chip, so the reader can see why nothing matched and untick it.
    const known = knownLabels(labelSet, nodes);
    for (const name of selected) {
      if (known.some((k) => labelKey(k.name) === labelKey(name))) continue;
      known.push({ name, color: "gray", defined: false, count: 0 });
    }

    let results: LabelResult[];
    if (searchTokens(query).length) {
      const hits = await searchPages(content, query, {
        space: space.key,
        filter,
        labels: selected,
        limit: LABELS_SEARCH_LIMIT,
      });
      results = hits.map((hit) => ({
        slug: hit.slug,
        title: hit.title,
        labels: hit.labels,
        text: hit.excerpt,
      }));
    } else {
      const matches = filterLabelled(nodes, selected);
      results = await mapWithConcurrency(matches, 32, async (node) => {
        let summary: string | undefined;
        try {
          summary = (await content.load(node.slug))?.data.summary;
        } catch {
          /* unreadable frontmatter — list it without a summary */
        }
        return { slug: node.slug, title: node.title, labels: node.labels ?? [], text: summary };
      });
    }

    return labelsDashboardLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey: space.key,
      tree,
      titles,
      spaceTitle: space.title,
      labelSet,
      known,
      selected,
      query,
      results,
      notice,
      username: username,
    });
  }

  app.get("/_dashboard/labels", async (req, reply) => {
    const space = await dashboardSpace(req, reply);
    if (!space) return reply;
    const selected = cleanLabelNames(queryStrings(req.query, "label")).slice(0, LABEL_FILTER_MAX);
    const query = (queryString(req.query, "q") ?? "").trim();
    return reply.type("text/html").send(await renderLabelsDashboard(space, selected, query));
  });

  /**
   * Set a page's labels from the sidebar's label dialog: the ticked names, plus
   * an optional new label to define and apply in the same step. Lands back on
   * the page the dialog was opened from, which need not be the labelled one.
   */
  app.post("/_labels/page", async (req, reply) => {
    const slug = (formString(req.body, "slug") ?? "").trim();
    const names = formStrings(req.body, "label");
    const newName = formString(req.body, "newName") ?? "";
    const newColor = formString(req.body, "newColor") ?? "gray";
    const returnTo = formString(req.body, "returnTo");
    const back = returnTo ? safeRedirectPath(returnTo) : pagePath(slug);

    let written: Written<LabelMutation> | null;
    try {
      written = await writes.labelPage(
        slug,
        names,
        newName.trim() ? { name: newName, color: newColor } : undefined
      );
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      const { status, html } = await renderPage(slug, { notice });
      return reply.code(status === 404 ? 404 : 400).type("text/html").send(html);
    }
    if (!written) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, slug.replace(/^\/+/, ""), spaces, username));
    }

    if (written.commitError) {
      const notice = {
        tone: "error",
        text: `Labels saved, but Git commit failed: ${written.commitError}`,
      } satisfies ViewNotice;
      const { html } = await renderPage(slug, { notice });
      return reply.code(500).type("text/html").send(html);
    }

    return reply.redirect(back, 303);
  });

  /**
   * The shared tail of the label-management posts: run the write and return to
   * the management section. A refusal re-renders the Labels view with the
   * reason, as the folder rename does for its page.
   */
  async function labelManagementPost(
    req: FastifyRequest,
    reply: FastifyReply,
    run: (space: SpaceInfo) => Promise<Written<LabelMutation>>
  ): Promise<FastifyReply> {
    const space = await findSpace(formString(req.body, "space") ?? "");
    if (!space) {
      const spaces = await content.spaces();
      return reply
        .code(404)
        .type("text/html")
        .send(notFound(siteTitle, formString(req.body, "space") ?? "", spaces, username));
    }

    let written: Written<LabelMutation>;
    try {
      written = await run(space);
    } catch (err) {
      const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
      return reply
        .code(400)
        .type("text/html")
        .send(await renderLabelsDashboard(space, [], "", notice));
    }

    if (written.commitError) {
      const notice = {
        tone: "error",
        text: `Saved, but Git commit failed: ${written.commitError}`,
      } satisfies ViewNotice;
      return reply
        .code(500)
        .type("text/html")
        .send(await renderLabelsDashboard(space, [], "", notice));
    }

    return reply.redirect(`${labelsHref(space.key)}#manage-labels`, 303);
  }

  app.post("/_labels/create", async (req, reply) =>
    labelManagementPost(req, reply, (space) =>
      writes.createLabel(space.key, formString(req.body, "name") ?? "", formString(req.body, "color") ?? "gray")
    )
  );

  app.post("/_labels/update", async (req, reply) =>
    labelManagementPost(req, reply, (space) =>
      writes.updateLabel(space.key, formString(req.body, "name") ?? "", {
        name: formString(req.body, "newName") ?? undefined,
        color: formString(req.body, "newColor") ?? undefined,
      })
    )
  );

  app.post("/_labels/delete", async (req, reply) =>
    labelManagementPost(req, reply, (space) => writes.deleteLabel(space.key, formString(req.body, "name") ?? ""))
  );
}
