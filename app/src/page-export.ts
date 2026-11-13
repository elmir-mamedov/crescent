/**
 * A page as Download ▸ Markdown hands it out: a file that has left the KB, so
 * it carries the page as it reads and none of KB25's own bookkeeping.
 */
import { parseFrontmatter } from "./frontmatter.js";
import { resolveWikiTarget, splitFragment } from "./markdown.js";
import { stripNotes } from "./notes.js";

/** What a download needs to know of the KB to write the page's links out. */
export interface ExportContext {
  /** The page being downloaded. */
  slug: string;
  /** A page's title by its slug; undefined when no page has that slug. */
  resolveTitle: (slug: string) => string | undefined;
  /** A page's slug by its id; undefined when no page has that id. */
  resolveIdSlug: (id: string) => string | undefined;
}

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
 * and when, which its PDF leaves out as well. And so do the links into the KB,
 * which lead nowhere from a file: each becomes its text, as in the PDF.
 */
export function downloadMarkdown(raw: string, ctx: ExportContext): string {
  let source: { data: Record<string, unknown>; body: string };
  try {
    source = parseFrontmatter(raw);
  } catch {
    return raw;
  }
  const title = typeof source.data.title === "string" ? source.data.title.replace(/\s+/g, " ").trim() : "";
  const body = rewriteBody(stripNotes(source.body), ctx).replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  return `${[title && `# ${title}`, body].filter(Boolean).join("\n\n")}\n`;
}

/** An opening or closing code fence: three or more backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Rewrite the links on every line of `body` that is not fenced code. Fence
 * tracking mirrors `scanNotes`: a link written in a code sample is text there,
 * and stays as it was written.
 */
function rewriteBody(body: string, ctx: ExportContext): string {
  const lines = body.split("\n");
  let fence = "";
  for (let i = 0; i < lines.length; i += 1) {
    const rail = FENCE_RE.exec(lines[i]);
    if (fence) {
      if (rail && rail[1][0] === fence[0] && rail[1].length >= fence.length && !rail[2].trim()) {
        fence = "";
      }
      continue;
    }
    if (rail && !(rail[1][0] === "`" && rail[2].includes("`"))) {
      fence = rail[1];
      continue;
    }
    lines[i] = rewriteInline(lines[i], ctx);
  }
  return lines.join("\n");
}

/** The length of the run of backticks starting at `at`. */
function backtickRun(s: string, at: number): number {
  let run = 0;
  while (s[at + run] === "`") run += 1;
  return run;
}

/**
 * Where the code span opening at `at` ends (the index past its closing
 * backticks), or -1 when no run of the same length closes it, which leaves
 * the backticks as text.
 */
function codeSpanEnd(s: string, at: number): number {
  const run = backtickRun(s, at);
  for (let i = at + run; i < s.length; ) {
    if (s[i] !== "`") {
      i += 1;
      continue;
    }
    const closing = backtickRun(s, i);
    if (closing === run) return i + closing;
    i += closing;
  }
  return -1;
}

/** One `[text](destination …)` link or image found in a line of Markdown. */
interface InlineLink {
  /** The text between the brackets, as written. */
  text: string;
  /** The destination, without its angle brackets when it had them. */
  dest: string;
  /** The `(…)` part, as written. */
  tail: string;
  /** The index past the closing `)`. */
  end: number;
}

/**
 * Read the inline link whose `[` is at `open`, the way markdown-it reads one:
 * brackets balance inside the text, which a code span or an escape takes out
 * of the count, and the destination may sit in angle brackets or keep its
 * parentheses balanced. A title in quotes or parentheses may follow it, and
 * an image a `=WxH` size. Anything else is not a link: null.
 */
function readLink(s: string, open: number): InlineLink | null {
  let depth = 0;
  let close = -1;
  for (let i = open; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\") {
      i += 1;
    } else if (ch === "`") {
      const end = codeSpanEnd(s, i);
      i = (end < 0 ? i + backtickRun(s, i) : end) - 1;
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0 || s[close + 1] !== "(") return null;

  let at = close + 2;
  const skipSpace = () => {
    while (s[at] === " " || s[at] === "\t") at += 1;
  };
  skipSpace();
  let dest: string;
  if (s[at] === "<") {
    const end = s.indexOf(">", at + 1);
    if (end < 0) return null;
    dest = s.slice(at + 1, end);
    at = end + 1;
  } else {
    const start = at;
    let parens = 0;
    while (at < s.length) {
      const ch = s[at];
      if (ch === "\\") {
        at += 2;
        continue;
      }
      if (ch === " " || ch === "\t") break;
      if (ch === "(") parens += 1;
      if (ch === ")") {
        if (parens === 0) break;
        parens -= 1;
      }
      at += 1;
    }
    dest = s.slice(start, at);
  }
  skipSpace();
  const quote = s[at];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    at += 1;
    while (at < s.length && s[at] !== closer) at += s[at] === "\\" ? 2 : 1;
    if (at >= s.length) return null;
    at += 1;
    skipSpace();
  }
  const size = /^=\d*x\d*/.exec(s.slice(at));
  if (size) {
    at += size[0].length;
    skipSpace();
  }
  if (s[at] !== ")") return null;
  return { text: s.slice(open + 1, close), dest, tail: s.slice(close + 1, at + 1), end: at + 1 };
}

/**
 * Rewrite the links in one line of Markdown outside its code spans: a
 * wiki-link becomes the text the page shows for it, a Markdown link into the
 * KB its own text, and the rest is left as written.
 */
function rewriteInline(s: string, ctx: ExportContext): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      out += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = codeSpanEnd(s, i);
      const stop = end < 0 ? i + backtickRun(s, i) : end;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "[" && s[i + 1] === "[") {
      // The span the renderer's wiki-link rule claims: up to the first `]]`.
      const close = s.indexOf("]]", i + 2);
      if (close >= 0) {
        out += wikiLinkText(s.slice(i + 2, close), ctx);
        i = close + 2;
        continue;
      }
    }
    const image = ch === "!" && s[i + 1] === "[";
    if (ch === "[" || image) {
      const link = readLink(s, image ? i + 1 : i);
      if (link) {
        out += image ? s.slice(i, link.end) : linkMarkdown(link, ctx);
        i = link.end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * A Markdown link as the download writes it. One into the KB leads nowhere
 * from a file, so it becomes its text, as the PDF prints it; one to a section
 * of this page stays a link to that section. A link that leaves the KB, and
 * one to the page's own files (`_assets/…`), stay as written.
 */
function linkMarkdown(link: InlineLink, ctx: ExportContext): string {
  const text = rewriteInline(link.text, ctx);
  const dest = link.dest;
  if (!dest || dest.startsWith("#") || dest.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("_assets/")) {
    return `[${text}]${link.tail}`;
  }
  let url: URL;
  try {
    url = new URL(dest, `http://kb${pageUrl(ctx.slug)}`);
  } catch {
    return `[${text}]${link.tail}`;
  }
  return url.hash && slugOfPath(url.pathname) === ctx.slug ? `[${text}](${url.hash})` : text;
}

/** A page's path on the server, each segment encoded as the renderer does. */
function pageUrl(slug: string): string {
  return "/" + slug.split("/").map(encodeURIComponent).join("/");
}

/** The slug a server path names. */
function slugOfPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* a stray % is part of the name */
  }
  return decoded.replace(/^\/+|\/+$/g, "");
}

/**
 * A `[[…]]` wiki-link as the download writes it: the text the page shows for
 * it, which is its label or else the title of the page it leads to, read the
 * way the renderer's wiki-link rule reads it. A link to a section of this page
 * stays a link to that section.
 */
function wikiLinkText(inner: string, ctx: ExportContext): string {
  const unescaped = inner.replace(/\\\|/g, "|");
  const bar = unescaped.indexOf("|");
  const label = bar === -1 ? "" : unescaped.slice(bar + 1).trim();
  const { target: rawTarget, fragment } = splitFragment(bar === -1 ? unescaped : unescaped.slice(0, bar));
  const target = rawTarget.trim();
  const id = /^id:(.+)$/.exec(target)?.[1].trim();
  const slug = id
    ? ctx.resolveIdSlug(id)
    : resolveWikiTarget(rawTarget, ctx.slug, (s) => ctx.resolveTitle(s) !== undefined);
  const shown =
    label || (slug === undefined ? id ?? "" : ctx.resolveTitle(slug) || slug.split("/").pop() || slug);
  const text = escapeText(shown);
  return slug === ctx.slug && fragment ? `[${text}](#${encodeURIComponent(fragment)})` : text;
}

/**
 * Text that reads as itself in Markdown. A title or a label is plain text on
 * the page, so nothing in it may turn into emphasis, a link, code, math or a
 * table cell's edge once it stands in the file on its own. An underscore only
 * starts emphasis at a word's edge, so one inside a word is left alone.
 */
function escapeText(text: string): string {
  return text
    .replace(/[\\`*[\]<>$|~&]/g, "\\$&")
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
}
