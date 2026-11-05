/** The sidebar's search box, answered in JSON. */
import type { FastifyInstance } from "fastify";
import { cleanLabelNames } from "../frontmatter.js";
import { labelledPages } from "../labels.js";
import { searchPages, searchTokens, type SearchHit } from "../search.js";
import type { ServerContext } from "./context.js";
import { errorMessage, pagePath, queryString, queryStrings } from "./http.js";
import { LABEL_FILTER_MAX } from "./labels.js";

// Sidebar search. A single character matches nearly every page, so the client is
// told not to ask and the server refuses anyway; the cap bounds the payload the
// dropdown can be handed.
const SEARCH_MIN_QUERY = 2;
const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;

export function registerSearchRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { content } = ctx;
  const { findSpace } = ctx.render;

  /**
   * Type-ahead search for the sidebar box, scoped to one space. Read-only, so GET —
   * which also makes it inspectable with curl and lets the client cancel a
   * superseded request cleanly.
   *
   * Excerpts are returned as plain text plus the query's tokens; the client wraps
   * the matches in <mark> itself. No HTML crosses the wire, so page bodies — the
   * least trustworthy strings in the system — can never inject markup here.
   *
   * Repeated `label` parameters narrow the results to pages carrying every one;
   * with labels and no usable query, it lists those pages in navigation order.
   */
  app.get("/_search", async (req, reply) => {
    // Results are derived from authenticated content and change on every edit, so
    // no browser or proxy may keep a copy. Fastify sets no cache headers of its
    // own, which would otherwise leave a bare 200 GET heuristically cacheable.
    reply.header("cache-control", "no-store");

    const query = (queryString(req.query, "q") ?? "").trim();
    const labels = cleanLabelNames(queryStrings(req.query, "label")).slice(0, LABEL_FILTER_MAX);
    // With labels picked, no query is a question too: which pages carry them.
    const browsing = query.length < SEARCH_MIN_QUERY;
    if (browsing && !labels.length) {
      return reply.code(400).send({ ok: false, error: "Query is too short." });
    }

    const spaceKey = content.spaceKeyOf(queryString(req.query, "space") ?? "");
    if (!spaceKey) {
      return reply.code(400).send({ ok: false, error: "Missing space." });
    }
    const space = await findSpace(spaceKey);
    if (!space) {
      return reply.code(404).send({ ok: false, error: `No space named "${spaceKey}".` });
    }

    const rawLimit = queryString(req.query, "limit");
    const parsedLimit = rawLimit === null ? NaN : Number.parseInt(rawLimit, 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), SEARCH_LIMIT_MAX)
      : SEARCH_LIMIT_DEFAULT;

    // A "live" tree drops an archived space's own node, and with it every page
    // beneath — scoping to one would silently return nothing. Its pages are
    // still browsable, so widen the filter for that case alone.
    const filter = space.archived ? "all" : "live";
    let hits: Array<Pick<SearchHit, "slug" | "title" | "excerpt" | "labels">>;
    try {
      hits = browsing
        ? (await labelledPages(content, spaceKey, filter, labels))
            .slice(0, limit)
            .map((node) => ({ slug: node.slug, title: node.title, excerpt: "", labels: node.labels ?? [] }))
        : await searchPages(content, query, { space: spaceKey, limit, filter, labels });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: errorMessage(err) });
    }

    return reply.send({
      ok: true,
      query: browsing ? "" : query,
      space: spaceKey,
      labels,
      tokens: browsing ? [] : searchTokens(query),
      results: hits.map((hit) => ({
        slug: hit.slug,
        title: hit.title,
        url: pagePath(hit.slug),
        // Middle segments only: the space is implied and the leaf is the title.
        crumb: hit.slug.split("/").slice(1, -1).join(" / "),
        excerpt: hit.excerpt,
        labels: hit.labels,
      })),
    });
  });
}
