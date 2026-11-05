/**
 * Arranging the sidebar by dragging: moving pages into another page or to a
 * space's top level, and placing them at an exact spot among their siblings.
 * Both are fetch-driven and answer in JSON.
 */
import type { FastifyInstance } from "fastify";
import type { BatchMoveMutation, ReorderMutation } from "../content.js";
import type { Written } from "../kb-writes.js";
import type { ServerContext } from "./context.js";
import { errorMessage, formString, pagePath } from "./http.js";

/**
 * The dragged pages a move/reorder request names: either a JSON array (multi-drag)
 * or a lone `sourceSlug`. Returns null when the array is unparseable, which the
 * caller reports as a bad request rather than treating as "nothing selected".
 */
function parseSourceSlugs(body: unknown): string[] | null {
  const rawSlugs = formString(body, "sourceSlugs");
  if (rawSlugs) {
    try {
      const parsed: unknown = JSON.parse(rawSlugs);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s): s is string => typeof s === "string" && s !== "");
    } catch {
      return null;
    }
  }
  const singleSlug = formString(body, "sourceSlug") ?? "";
  return singleSlug ? [singleSlug] : [];
}

export function registerMoveRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { writes } = ctx;

  app.post("/_move", async (req, reply) => {
    const targetKind = formString(req.body, "targetKind") ?? "";
    const targetSlug = formString(req.body, "targetSlug") ?? "";

    const sourceSlugs = parseSourceSlugs(req.body);
    if (sourceSlugs === null) {
      return reply.code(400).send({ ok: false, error: "Invalid source list." });
    }

    if (sourceSlugs.length === 0) {
      return reply.code(400).send({ ok: false, error: "Missing source page." });
    }
    if (targetKind !== "root" && targetKind !== "page") {
      return reply.code(400).send({ ok: false, error: "Invalid destination." });
    }
    if (targetKind === "page" && !targetSlug) {
      return reply.code(400).send({ ok: false, error: "Missing destination page." });
    }

    let written: Written<BatchMoveMutation>;
    try {
      written = await writes.movePages(
        sourceSlugs,
        targetKind === "root" ? null : targetSlug
      );
    } catch (err) {
      return reply.code(400).send({ ok: false, error: errorMessage(err) });
    }

    const { mutation: result, commitError } = written;
    if (result.moves.length === 0) {
      const error = result.failures[0]?.error ?? "Source page not found.";
      return reply.code(result.failures.length ? 400 : 404).send({ ok: false, error });
    }

    if (commitError) {
      return reply.code(500).send({
        ok: false,
        error: `Moved, but Git commit failed: ${commitError}`,
        url: pagePath(result.moves[0].newSlug),
      });
    }

    // A partial failure still reports ok (the successful moves landed); the note
    // is surfaced to the user alongside the reload.
    const total = result.moves.length + result.failures.length;
    const failureNote = result.failures.length
      ? `${result.failures.length} of ${total} could not be moved: ${result.failures
          .map((f) => f.error)
          .join("; ")}`
      : undefined;

    return reply.send({
      ok: true,
      moved: result.moves.map((m) => ({ oldSlug: m.oldSlug, newSlug: m.newSlug })),
      slug: result.moves[0].newSlug,
      url: pagePath(result.moves[0].newSlug),
      ...(failureNote ? { error: failureNote } : {}),
    });
  });

  /**
   * Place pages at an exact spot in a group — the sidebar's insertion-line drop.
   * `parentSlug` is the group (a space key for the top level), `beforeSlug` the
   * sibling to land above, empty to append. Re-parenting and renumbering are one
   * request because one drop can imply both, and they must land in one commit.
   *
   * Fetch-driven like `/_move`, but it answers with the moves rather than a URL to
   * follow: arranging a page the reader is not currently on must not navigate away,
   * so the client reloads in place and only follows a slug that actually changed.
   */
  app.post("/_reorder", async (req, reply) => {
    const parentSlug = formString(req.body, "parentSlug") ?? "";
    const beforeSlug = formString(req.body, "beforeSlug") ?? "";

    const sourceSlugs = parseSourceSlugs(req.body);
    if (sourceSlugs === null) {
      return reply.code(400).send({ ok: false, error: "Invalid source list." });
    }
    if (sourceSlugs.length === 0) {
      return reply.code(400).send({ ok: false, error: "Missing source page." });
    }
    if (!parentSlug) {
      return reply.code(400).send({ ok: false, error: "Missing destination group." });
    }

    let written: Written<ReorderMutation>;
    try {
      written = await writes.reorderPages(sourceSlugs, parentSlug, beforeSlug);
    } catch (err) {
      return reply.code(400).send({ ok: false, error: errorMessage(err) });
    }

    const { mutation: result, commitError } = written;
    if (result.orderedSlugs.length === 0) {
      const error = result.failures[0]?.error ?? "Source page not found.";
      return reply.code(result.failures.length ? 400 : 404).send({ ok: false, error });
    }

    if (commitError) {
      return reply.code(500).send({
        ok: false,
        error: `Reordered, but Git commit failed: ${commitError}`,
      });
    }

    const total = result.placedSlugs.length + result.failures.length;
    const failureNote = result.failures.length
      ? `${result.failures.length} of ${total} could not be moved: ${result.failures
          .map((f) => f.error)
          .join("; ")}`
      : undefined;

    return reply.send({
      ok: true,
      moved: result.moves.map((m) => ({ oldSlug: m.oldSlug, newSlug: m.newSlug })),
      parentSlug: result.parentSlug,
      orderedSlugs: result.orderedSlugs,
      ...(failureNote ? { error: failureNote } : {}),
    });
  });
}
