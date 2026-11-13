/**
 * A page as Download ▸ Markdown hands it out: a file that has left the KB, so
 * it carries the page as it reads and none of KB25's own bookkeeping.
 */
import { parseFrontmatter } from "./frontmatter.js";
import { stripNotes } from "./notes.js";

/**
 * Filename for a page downloaded as Markdown: its slug leaf + ".md". Slug
 * segments are already lowercase-hyphenated and URL-safe, so this is safe to
 * drop into a Content-Disposition header. Falls back to "page.md" for the
 * (leaf-less) home page.
 */
export function downloadFilename(slug: string): string {
  const leaf = slug.split("/").filter(Boolean).at(-1) ?? "";
  return `${leaf || "page"}.md`;
}

/**
 * A page as the Markdown file Download hands out (feedback #59): the page as
 * it reads, without the frontmatter that keeps its metadata. Its id, tags,
 * labels, order and the rest are KB25's bookkeeping and mean nothing in a file
 * that has left it. The title, which the frontmatter held, leads the file as
 * its heading, as it leads the page and its PDF. A header that cannot be read
 * has no telling where it ends, so that file goes out as it is.
 *
 * The inline notes go too (feedback #60): tasks, remarks, highlights and the
 * agent's notes are the readers' working marks on the page, with who left them
 * and when, which its PDF leaves out as well.
 */
export function downloadMarkdown(raw: string): string {
  let source: { data: Record<string, unknown>; body: string };
  try {
    source = parseFrontmatter(raw);
  } catch {
    return raw;
  }
  const title = typeof source.data.title === "string" ? source.data.title.replace(/\s+/g, " ").trim() : "";
  const body = stripNotes(source.body).replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  return `${[title && `# ${title}`, body].filter(Boolean).join("\n\n")}\n`;
}
