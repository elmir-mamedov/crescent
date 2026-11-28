/** The getting-started guide as Help shows it: crescent's own copy, read-only. */
import type { FastifyInstance } from "fastify";
import { Content, flatten } from "../content.js";
import { EXAMPLE_SPACE } from "../example-space.js";
import { GUIDE_SPACE } from "../guide.js";
import { createRenderer } from "../markdown.js";
import { guideLayout, type GuidePageLink } from "../views/guide.js";

/** Where the guide's pages are shown. A page's slug follows it, as in a space. */
const BASE = "_guide";

/**
 * GET /_guide shows the guide's start page and GET /_guide/<slug> any page of
 * it, read from the guide folder that ships with crescent rather than from the
 * knowledge base. Its links are resolved within the guide and point back into
 * /_guide/.
 */
export function registerGuideRoutes(app: FastifyInstance, opts: { guideDir: string; startTour?: boolean }): void {
  const guide = new Content(opts.guideDir);

  // Just after crescent added the example space (offerExampleSpace), the first
  // visit to the spaces page goes to that space instead, with the tour
  // (views/tour.ts) starting on it: a new person lands on real pages, shown
  // around. Once only, and only while this server runs.
  let tourPending = opts.startTour === true;
  app.addHook("onRequest", async (req, reply) => {
    if (!tourPending || req.method !== "GET" || req.url !== "/") return;
    tourPending = false;
    return reply.redirect(`/${EXAMPLE_SPACE}?tour=start`);
  });

  async function renderGuidePage(slug: string): Promise<string | null> {
    const page = await guide.load(slug);
    if (!page || page.slug.split("/")[0] !== GUIDE_SPACE) return null;
    const [titles, ids, tree] = await Promise.all([guide.titleIndex(), guide.idIndex(), guide.spaceTree(GUIDE_SPACE)]);
    // Every slug the renderer sees is one under /_guide/, so the links it
    // writes, `/<slug>`, land there.
    const md = createRenderer(
      (s) => (s.startsWith(`${BASE}/`) ? titles.get(s.slice(BASE.length + 1)) : undefined),
      `${BASE}/${page.slug}`,
      (id) => {
        const target = ids.get(id);
        return target ? `${BASE}/${target}` : undefined;
      }
    );
    const start: GuidePageLink = { href: `/${BASE}/${GUIDE_SPACE}`, title: titles.get(GUIDE_SPACE) ?? "Getting started" };
    const pages = [start, ...flatten(tree).map((node) => ({ href: `/${BASE}/${node.slug}`, title: node.title }))];
    return guideLayout({
      title: page.data.title,
      contentHtml: md.render(page.body, {}),
      pages,
      activeHref: `/${BASE}/${page.slug}`,
    });
  }

  app.get(`/${BASE}`, async (_req, reply) => reply.redirect(`/${BASE}/${GUIDE_SPACE}`));

  app.get<{ Params: { "*": string } }>(`/${BASE}/*`, async (req, reply) => {
    const html = await renderGuidePage(req.params["*"]);
    if (!html) return reply.code(404).type("text/html; charset=utf-8").send(await renderGuidePage(GUIDE_SPACE));
    return reply.type("text/html; charset=utf-8").send(html);
  });
}
