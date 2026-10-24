import yaml from "js-yaml";
import { z } from "zod";

/**
 * The minimal page frontmatter schema agreed in Step 1.
 * `created` / `updated` / `author` are intentionally NOT here — they come from
 * git, so there's a single source of truth and nothing to keep in sync.
 */
export const FrontmatterSchema = z.object({
  title: z.string().min(1, "title is required"),
  /**
   * Stable, immutable page identity. Unlike the slug (which is the file path and
   * changes on move/rename), the id never changes, so an `[[id:<id>]]` link keeps
   * resolving after a page is moved. Optional so pages predating the id backfill
   * still validate; new pages get one on create and the migration adds it to the rest.
   */
  id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /**
   * Curated, coloured markers a person sets from the sidebar ("Draft", "Needs
   * review"). Unlike `tags` — free keywords for search — every label name is
   * meant to come from the space's palette in `_labels.json`, which owns its
   * colour. A name missing from the palette still counts; it just renders grey.
   */
  labels: z.array(z.string()).optional(),
  summary: z.string().optional(),
  /**
   * Sibling position in the navigation, ascending. Sidebar drag-and-drop
   * renumbers every sibling in the group it touches from 1; a newly created page
   * is stamped one below its lowest sibling (so 0, then -1, …) and therefore opens
   * at the top of its level. Absent means "unplaced" — a page written before this
   * was stamped, or one that has moved out of the group it was arranged into:
   * those sort after the placed ones, by title (see Content.walk). Any number is
   * accepted, so a fractional value can be hand-written to slot a page between two
   * ordered siblings without renumbering them.
   */
  order: z.number().optional(),
  /** Optional emoji shown on the space card; only meaningful on a space's index.md. */
  icon: z.string().optional(),
  /**
   * Marks a directory's index.md as a pure container ("folder") rather than a
   * content page. Only "folder" is meaningful; its absence means an ordinary
   * page/section. Kept optional so every existing page validates unchanged.
   */
  type: z.literal("folder").optional(),
  archived: z.boolean().optional(),
  archivedAt: z.string().optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** Longest label name accepted from a person; long enough for a phrase, short enough for a chip. */
export const LABEL_NAME_MAX = 40;

/**
 * The identity two label names are compared by: "Draft", " draft" and "DRAFT"
 * are one label. NFC folds the two ways of typing an accented letter together.
 */
export function labelKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

/**
 * Validate a label name typed by a person, returning it trimmed.
 *
 * Commas are refused because names travel through URLs and lists where a comma
 * reads as a separator; control characters because a name ends up in a commit
 * subject, where a newline would forge a second line.
 */
export function normalizeLabelName(raw: string): string {
  const name = raw.trim().normalize("NFC");
  if (!name) throw new Error("A label needs a name.");
  if (name.length > LABEL_NAME_MAX) {
    throw new Error(`A label name can be at most ${LABEL_NAME_MAX} characters.`);
  }
  if (name.includes(",")) throw new Error("A label name cannot contain a comma.");
  if (/\p{Cc}/u.test(name)) throw new Error("A label name cannot contain control characters.");
  return name;
}

/**
 * Tidy a label list read from a file: trims, drops empty and non-string
 * entries, and keeps the first spelling of names that compare equal. Lenient on
 * purpose — a hand-edited page should still render, not fail on a stray space.
 */
export function cleanLabelNames(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    const key = labelKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export interface ParsedPage {
  data: Frontmatter;
  body: string;
}

/** A page's frontmatter as written — every key, unvalidated — and the body after it. */
export interface PageSource {
  data: Record<string, unknown>;
  body: string;
}

const BOM = "﻿";

/** The header's exact text (delimiters included), the YAML between them, and the body. */
function locateFrontmatter(raw: string): { header: string; yaml: string; body: string } | null {
  const bom = raw.startsWith(BOM) ? BOM : "";
  const lines = raw.slice(bom.length).split("\n");
  if (lines[0].trimEnd() !== "---") return null;

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trimEnd() === "---") {
      return {
        header: bom + lines.slice(0, i + 1).join("\n") + "\n",
        yaml: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
}

/**
 * Split a raw `.md` file into its frontmatter header and its body, preserving
 * the header's bytes exactly, byte-order mark included.
 *
 * Content edits re-serialise frontmatter through {@link stringifyPage} because
 * they are editing the YAML; a note write is not, and reformatting someone's
 * header as a side effect of leaving a comment would be a surprise in the diff.
 * It finds the header exactly where {@link parseFrontmatter} does, so a note's
 * line numbers always count from the body the parser sees.
 */
export function splitFrontmatter(raw: string): { header: string; body: string } {
  const found = locateFrontmatter(raw);
  return found ? { header: found.header, body: found.body } : { header: "", body: raw };
}

/**
 * The one way KB25 reads a page's frontmatter: a header opened and closed by a
 * line of exactly `---`, holding YAML, read with js-yaml's safe schema.
 *
 * Pages arrive from places KB25 does not control — a space's git remote, a
 * folder copied in, an agent's edit — and are parsed just by being shown, so
 * parsing must never run anything. That is why it is not gray-matter, which
 * KB25 used to call: it reads a `---js` opening line as "evaluate this header
 * as JavaScript". Such a header is refused here, never read. A file with no
 * header at all is all body, with empty data.
 */
export function parseFrontmatter(raw: string, sourceLabel = "page"): PageSource {
  const found = locateFrontmatter(raw);
  if (!found) {
    const firstLine = raw.replace(/^﻿/, "").split("\n", 1)[0].trimEnd();
    if (firstLine === "---") {
      throw new Error(`Invalid frontmatter in ${sourceLabel}: the header has no closing "---" line.`);
    }
    if (/^---[^-]/.test(firstLine)) {
      throw new Error(
        `Invalid frontmatter in ${sourceLabel}: the header must open with a line of just "---"; a language after it, as in "---js", is not supported.`
      );
    }
    return { data: {}, body: raw.replace(/^﻿/, "") };
  }

  let loaded: unknown;
  try {
    loaded = yaml.safeLoad(found.yaml, { filename: sourceLabel, schema: yaml.DEFAULT_SAFE_SCHEMA });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid frontmatter in ${sourceLabel}: ${reason}`);
  }
  // An empty or comment-only header is no fields at all.
  if (loaded === undefined || loaded === null) return { data: {}, body: found.body };
  if (Object.prototype.toString.call(loaded) !== "[object Object]") {
    throw new Error(`Invalid frontmatter in ${sourceLabel}: the header must be a list of "key: value" fields.`);
  }
  return { data: loaded as Record<string, unknown>, body: found.body };
}

/**
 * Write `data` as a page's frontmatter in front of `body`, which is kept as
 * given (only a final newline is added when missing). No data, no header.
 * The output is exactly what gray-matter wrote, so pages it saved don't change
 * when they are next touched.
 */
export function stringifyPage(body: string, data: Record<string, unknown>): string {
  const fields = yaml.safeDump(data).trim();
  const header = fields === "{}" ? "" : `---\n${fields}\n---\n`;
  return header + (body.endsWith("\n") ? body : `${body}\n`);
}

/**
 * Parse a raw .md file: split frontmatter from body and validate it.
 * Throws a clear error if the frontmatter is malformed — so a bad header is
 * caught on read rather than crashing the renderer somewhere downstream.
 */
export function parsePage(raw: string, sourceLabel = "page"): ParsedPage {
  const { data, body } = parseFrontmatter(raw, sourceLabel);
  const result = FrontmatterSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid frontmatter in ${sourceLabel}: ${issues}`);
  }
  return { data: result.data, body };
}
