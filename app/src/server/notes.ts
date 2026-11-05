/** Inline notes: adding, editing and resolving the notes left on a page. */
import type { FastifyInstance } from "fastify";
import type { RawPage } from "../content.js";
import { splitFrontmatter } from "../frontmatter.js";
import type { Written } from "../kb-writes.js";
import { sourceBlocks } from "../markdown.js";
import {
  insertNote,
  isAgentNote,
  newNoteId,
  normalizeQuote,
  noteStamp,
  parseNotes,
  removeAgentNotes,
  removeNote,
  updateNote,
  type NoteKind,
} from "../notes.js";
import type { ServerContext } from "./context.js";
import { errorMessage, formString } from "./http.js";

/**
 * The body line a note should be inserted above.
 *
 * The reader's browser reports the block it was looking at by line *and*
 * fingerprint. The line is used when it still names that same block; otherwise
 * the block is looked up by fingerprint, which survives an edit elsewhere on the
 * page having shifted it up or down. When neither finds it the block is gone,
 * and refusing beats landing the note on whatever prose moved into its place.
 */
function resolveAnchor(body: string, line: number, hash: string): number | null {
  if (!hash) return null;
  const blocks = sourceBlocks(body);
  const atLine = blocks.find((b) => b.line === line);
  if (atLine?.hash === hash) return atLine.line;
  return blocks.find((b) => b.hash === hash)?.line ?? null;
}

/**
 * The note kind a form field names, or undefined if it names none of them.
 *
 * `agent` is missing on purpose: this is the list of kinds a *person* may write,
 * and leaving it out is what keeps an agent note something only an agent can
 * have said. A request naming it reads as naming nothing, so the add branch
 * below falls back to a task the same way it does for a typo.
 */
function noteKindOf(value: string | null): NoteKind | undefined {
  return value === "task" || value === "remark" || value === "highlight" ? value : undefined;
}

export function registerNoteRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { username, content, writes } = ctx;

  /**
   * Add, edit or resolve an inline note. Fetch-driven like `/_move`, because the
   * reader stays on the page rather than navigating away from it.
   *
   * Resolving deletes the note outright: git keeps both the note and the edit it
   * prompted, so there is nothing to gain from leaving a tombstone in the prose.
   */
  app.post("/_notes/*", async (req, reply) => {
    const slug = String((req.params as Record<string, string>)["*"] ?? "");
    const page = await content.loadRaw(slug);
    if (!page) return reply.code(404).send({ ok: false, error: "Page not found." });

    const { header, body } = splitFrontmatter(page.raw);
    const op = formString(req.body, "op");
    let nextBody: string;
    // How the commit subject opens; the page's path follows it.
    let action: string;

    if (op === "resolve") {
      const removed = removeNote(body, formString(req.body, "noteId") ?? "");
      if (removed === null) {
        return reply
          .code(409)
          .send({ ok: false, error: "That note is already gone. Reload the page." });
      }
      nextBody = removed;
      action = "Resolve note on";
    } else if (op === "resolve-agent") {
      // Every agent note the reader could see on the page (feedback #46), in one
      // commit. The ids are the ones their page showed, so a note an agent left
      // since then stays up until it has been seen.
      const ids = (formString(req.body, "noteIds") ?? "").split(/\s+/).filter(Boolean);
      const result = removeAgentNotes(body, ids);
      if (!result.removed) {
        return reply
          .code(409)
          .send({ ok: false, error: "Those notes are already gone. Reload the page." });
      }
      nextBody = result.body;
      action = `Resolve ${result.removed === 1 ? "agent note" : "agent notes"} on`;
    } else if (op === "edit") {
      const noteId = formString(req.body, "noteId") ?? "";
      const current = parseNotes(body).find((note) => note.id === noteId);
      if (!current) {
        return reply
          .code(409)
          .send({ ok: false, error: "That note is already gone. Reload the page." });
      }

      // A note from an agent is the agent's own words; a reader can take it down
      // but not put words in its mouth. The client offers no Edit button for one,
      // and this is the same rule where it actually holds.
      if (isAgentNote(current)) {
        return reply.code(403).send({
          ok: false,
          error: "A note from the agent can't be edited — resolve it instead.",
        });
      }

      // An absent or unrecognised kind leaves the note's own rather than quietly
      // retyping it — so whether an empty text is allowed is judged on the kind the
      // note ends up with, not the one it was sent with.
      const kind = noteKindOf(formString(req.body, "kind"));
      const text = (formString(req.body, "text") ?? "").trim();
      if (!text && (kind ?? current.kind) !== "highlight") {
        return reply.code(400).send({ ok: false, error: "Write the note first." });
      }

      // The note keeps its anchor, its id and its timestamp — only what the writer
      // retyped changes.
      const edited = updateNote(body, noteId, { text, kind });
      if (edited === null) {
        return reply
          .code(409)
          .send({ ok: false, error: "That note is already gone. Reload the page." });
      }
      nextBody = edited;
      action = "Edit note on";
    } else {
      // An absent or unrecognised kind reads as a task, the same way the parser
      // reads a hand-written note that names none.
      const kind = noteKindOf(formString(req.body, "kind")) ?? "task";
      const text = (formString(req.body, "text") ?? "").trim();
      const quote = normalizeQuote(formString(req.body, "quote") ?? "");
      // A highlight *is* the marked phrase, so it saves with nothing typed; the
      // other two kinds are messages and would say nothing without one. A highlight
      // with no quote either would be a note with neither words nor a mark.
      if (!text && !(kind === "highlight" && quote)) {
        return reply.code(400).send({ ok: false, error: "Write the note first." });
      }

      const line = resolveAnchor(
        body,
        Number(formString(req.body, "line")),
        formString(req.body, "hash") ?? ""
      );
      if (line === null) {
        return reply
          .code(409)
          .send({ ok: false, error: "This page changed. Reload and try again." });
      }

      nextBody = insertNote(body, line, {
        id: newNoteId(),
        kind,
        at: noteStamp(),
        by: username,
        quote: quote || undefined,
        text,
      });
      action = "Add note to";
    }

    let written: Written<RawPage> | null;
    try {
      written = await writes.writeNotes(slug, header + nextBody, action);
    } catch (err) {
      return reply.code(400).send({ ok: false, error: errorMessage(err) });
    }
    if (!written) return reply.code(404).send({ ok: false, error: "Page not found." });

    if (written.commitError) {
      return reply
        .code(500)
        .send({ ok: false, error: `Saved, but Git commit failed: ${written.commitError}` });
    }

    return reply.send({ ok: true });
  });
}
