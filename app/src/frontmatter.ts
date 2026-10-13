import matter from "gray-matter";
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

/**
 * Parse a raw .md file: split frontmatter from body and validate it.
 * Throws a clear error if the frontmatter is malformed — so a bad header is
 * caught on read rather than crashing the renderer somewhere downstream.
 */
export function parsePage(raw: string, sourceLabel = "page"): ParsedPage {
  const { data, content } = matter(raw);
  const result = FrontmatterSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid frontmatter in ${sourceLabel}: ${issues}`);
  }
  return { data: result.data, body: content };
}
