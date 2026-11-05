/**
 * The Dashboards hub, which a space's corner button opens, and its open-tasks
 * report. Its other report, the Labels view, is in labels.ts.
 */
import type { FastifyInstance } from "fastify";
import type { SpaceInfo } from "../content.js";
import { filterLabelled, knownLabels, spaceNodes } from "../labels.js";
import { collectNotes, groupNotesByPage, summarizeNotes } from "../note-index.js";
import { dashboardLayout, dashboardsLayout, labelsHref } from "../views.js";
import type { ServerContext } from "./context.js";

export function registerDashboardRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { siteTitle, username, content } = ctx;
  const { dashboardSpace, spaceChrome } = ctx.render;

  /**
   * The notes dashboard for one space: its open task notes, counted and grouped.
   *
   * `archived` widens the tree filter the way `/_search` does — a `live` tree drops
   * an archived space's own node and every page under it, so a dashboard scoped to
   * one would report nothing at all.
   */
  async function renderNotesDashboard(
    spaceKey: string,
    spaceTitle: string,
    archived: boolean
  ): Promise<string> {
    const filter = archived ? "all" : "live";
    const [spaces, { tree, labelSet }, titles, notes] = await Promise.all([
      content.spaces(),
      spaceChrome(spaceKey, filter),
      content.titleIndex(),
      collectNotes(content, filter, { space: spaceKey, kind: "task" }),
    ]);

    return dashboardLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey,
      tree,
      labelSet,
      titles,
      spaceTitle,
      groups: groupNotesByPage(notes),
      summary: summarizeNotes(notes),
      now: Date.now(),
      username: username,
    });
  }

  /**
   * The Dashboards hub for one space: a card per report, each carrying the
   * number that sums it up. Same archived-space widening as the reports.
   */
  async function renderDashboardsHub(space: SpaceInfo): Promise<string> {
    const filter = space.archived ? "all" : "live";
    const [spaces, { tree, labelSet }, titles, tasks, nodes] = await Promise.all([
      content.spaces(),
      spaceChrome(space.key, filter),
      content.titleIndex(),
      collectNotes(content, filter, { space: space.key, kind: "task" }),
      spaceNodes(content, space.key, filter),
    ]);
    const query = `?space=${encodeURIComponent(space.key)}`;
    const taskCount = summarizeNotes(tasks).total;
    const labelledCount = filterLabelled(nodes, []).length;
    const labelCount = knownLabels(labelSet, nodes).length;

    return dashboardsLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey: space.key,
      tree,
      labelSet,
      titles,
      spaceTitle: space.title,
      cards: [
        {
          href: `/_dashboard/tasks${query}`,
          title: "Open tasks",
          description: "Task notes left on pages in this space, grouped by page.",
          value: String(taskCount),
          valueLabel: taskCount === 1 ? "open task" : "open tasks",
        },
        {
          href: labelsHref(space.key),
          title: "Labels",
          description: `${labelCount} ${labelCount === 1 ? "label" : "labels"} in this space. Filter and search pages by label.`,
          value: String(labelledCount),
          valueLabel: labelledCount === 1 ? "labelled page" : "labelled pages",
        },
      ],
      username: username,
    });
  }

  /** The Dashboards hub — what the corner button opens. */
  app.get("/_dashboard", async (req, reply) => {
    const space = await dashboardSpace(req, reply);
    if (!space) return reply;
    return reply.type("text/html").send(await renderDashboardsHub(space));
  });

  app.get("/_dashboard/tasks", async (req, reply) => {
    const space = await dashboardSpace(req, reply);
    if (!space) return reply;
    return reply
      .type("text/html")
      .send(await renderNotesDashboard(space.key, space.title, space.archived));
  });
}
