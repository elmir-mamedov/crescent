/**
 * A page as Download ▸ Markdown hands it out: a file that has left the KB, so
 * it carries the page as it reads and none of KB25's own bookkeeping. A page
 * that shows images or links its own files goes out as a zip of the Markdown
 * and those files.
 */
import { promises as fs } from "node:fs";
import type { Content } from "./content.js";
import { parseFrontmatter } from "./frontmatter.js";
import { resolveWikiTarget, splitFragment } from "./markdown.js";
import { stripNotes } from "./notes.js";
import { zip } from "./zip.js";

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

/** What Download ▸ Markdown sends: the page's Markdown, or a zip of it and its files. */
export interface PageDownload {
  filename: string;
  contentType: string;
  body: string | Buffer;
}

/**
 * The page `raw` as Download ▸ Markdown sends it (feedback #60). A file that
 * has left the KB has nothing behind its `_assets/…` paths, so a page that
 * shows an image or links one of its files goes out as `<page>.zip`: the
 * Markdown and, beside it, an `_assets/` folder with just the files it uses,
 * at the paths it already names them by. A page that uses none, or only files
 * that are not there, is the `.md` alone. The archive has no folder of its
 * own: unpacking it makes one named after it, in Finder and in Explorer.
 */
export async function downloadPage(
  content: Pick<Content, "resolveAsset">,
  raw: string,
  ctx: ExportContext
): Promise<PageDownload> {
  const { markdown, assets } = exportMarkdown(raw, ctx);
  const filename = downloadFilename(ctx.slug);
  const space = ctx.slug.split("/").filter(Boolean)[0] ?? "";
  const files = new Map<string, Buffer>();
  for (const asset of assets) {
    // resolveAsset splits a path the same way, and refuses one that climbs
    // out or hides a part behind a dot, so no name here can leave the archive.
    const name = asset.split(/[\\/]/).filter(Boolean).join("/");
    if (!name || files.has(name)) continue;
    const fsPath = await content.resolveAsset(space, name);
    if (fsPath) files.set(name, await fs.readFile(fsPath));
  }
  if (!files.size) {
    return { filename, contentType: "text/markdown; charset=utf-8", body: markdown };
  }
  return {
    filename: filename.replace(/\.md$/, ".zip"),
    contentType: "application/zip",
    body: zip([
      { name: filename, data: Buffer.from(markdown, "utf8") },
      ...[...files].map(([name, data]) => ({ name: `_assets/${name}`, data })),
    ]),
  };
}

/** A page as Markdown, and the files under its space's `_assets/` it uses. */
export interface MarkdownExport {
  markdown: string;
  /** Each file's path under `_assets/`, decoded, in the order the page uses them. */
  assets: string[];
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
 *
 * What stays is the page's own files: each image and link that names one keeps
 * naming it as `_assets/…`, and comes back in `assets` for the download to put
 * beside the file. An image sized with KB25's `=WxH` becomes an HTML `<img>`
 * with that width and height, which other Markdown readers understand.
 */
export function exportMarkdown(raw: string, ctx: ExportContext): MarkdownExport {
  let source: { data: Record<string, unknown>; body: string };
  try {
    source = parseFrontmatter(raw);
  } catch {
    return { markdown: raw, assets: [] };
  }
  const ex: Export = { ...ctx, space: ctx.slug.split("/").filter(Boolean)[0] ?? "", assets: new Set() };
  const title = typeof source.data.title === "string" ? source.data.title.replace(/\s+/g, " ").trim() : "";
  const body = rewriteBody(stripNotes(source.body), ex).replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  return {
    markdown: `${[title && `# ${title}`, body].filter(Boolean).join("\n\n")}\n`,
    assets: [...ex.assets],
  };
}

/** An export under way: what it knows of the KB, and the files it found. */
interface Export extends ExportContext {
  /** The space the page is in, whose `_assets/` its files come from. */
  space: string;
  assets: Set<string>;
}

/** An opening or closing code fence: three or more backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Rewrite the links on every line of `body` that is not fenced code. Fence
 * tracking mirrors `scanNotes`: a link written in a code sample is text there,
 * and stays as it was written.
 */
function rewriteBody(body: string, ex: Export): string {
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
    lines[i] = rewriteInline(lines[i], ex);
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
  /** The title, as written with its quotes; "" when there is none. */
  title: string;
  /** An image's `=WxH` size, each "" when not given. */
  width: string;
  height: string;
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
  const titleStart = at;
  const quote = s[at];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    at += 1;
    while (at < s.length && s[at] !== closer) at += s[at] === "\\" ? 2 : 1;
    if (at >= s.length) return null;
    at += 1;
  }
  const title = s.slice(titleStart, at);
  skipSpace();
  // As the renderer's image rule reads it: a size names at least one side.
  const size = /^=(\d*)x(\d*)/.exec(s.slice(at));
  if (size && (size[1] || size[2])) {
    at += size[0].length;
    skipSpace();
  }
  if (s[at] !== ")") return null;
  return {
    text: s.slice(open + 1, close),
    dest,
    title,
    width: size?.[1] ?? "",
    height: size?.[2] ?? "",
    tail: s.slice(close + 1, at + 1),
    end: at + 1,
  };
}

/**
 * Rewrite the links in one line of Markdown outside its code spans: a
 * wiki-link becomes the text the page shows for it, a Markdown link into the
 * KB its own text, and the rest is left as written.
 */
function rewriteInline(s: string, ex: Export): string {
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
        out += wikiLinkText(s.slice(i + 2, close), ex);
        i = close + 2;
        continue;
      }
    }
    const image = ch === "!" && s[i + 1] === "[";
    if (ch === "[" || image) {
      const link = readLink(s, image ? i + 1 : i);
      if (link) {
        out += image ? imageMarkdown(link, ex) : linkMarkdown(link, ex);
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
 * of this page stays a link to that section. A link that leaves the KB stays
 * as written, and so does one to the page's own files, which go with it.
 */
function linkMarkdown(link: InlineLink, ex: Export): string {
  const text = rewriteInline(link.text, ex);
  const dest = link.dest;
  const asset = assetOf(dest, ex);
  if (asset !== null) {
    if (dest.startsWith("_assets/")) return `[${text}]${link.tail}`;
    return `[${text}](${assetHref(asset)}${link.title && ` ${link.title}`})`;
  }
  if (leavesKb(dest)) return `[${text}]${link.tail}`;
  const url = pageRelative(dest, ex.slug);
  if (!url) return `[${text}]${link.tail}`;
  return url.hash && slugOfPath(url.pathname) === ex.slug ? `[${text}](${url.hash})` : text;
}

/**
 * An image as the download writes it. One of the page's own files goes with
 * it and is named as `_assets/…`, however the page reached it. An image sized
 * with KB25's `=WxH`, which no other reader knows, becomes an `<img>` tag of
 * that size; any other is left as written.
 */
function imageMarkdown(link: InlineLink, ex: Export): string {
  const asset = assetOf(link.dest, ex);
  const src = asset === null || link.dest.startsWith("_assets/") ? link.dest : assetHref(asset);
  if (link.width || link.height) {
    const attrs: [string, string][] = [
      ["src", src],
      ["alt", link.text.replace(/\\([!-/:-@[-`{-~])/g, "$1")],
    ];
    if (link.title) attrs.push(["title", link.title.slice(1, -1).replace(/\\([!-/:-@[-`{-~])/g, "$1")]);
    if (link.width) attrs.push(["width", link.width]);
    if (link.height) attrs.push(["height", link.height]);
    return `<img ${attrs.map(([name, value]) => `${name}="${escapeAttr(value)}"`).join(" ")}>`;
  }
  if (src === link.dest) return `![${link.text}]${link.tail}`;
  return `![${link.text}](${src}${link.title && ` ${link.title}`})`;
}

/** Whether a destination is somewhere a file can reach as well: a URL, an anchor. */
function leavesKb(dest: string): boolean {
  return !dest || dest.startsWith("#") || dest.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(dest);
}

/** A destination resolved the way the browser resolves it from the page. */
function pageRelative(dest: string, slug: string): URL | null {
  try {
    return new URL(dest, `http://kb${pageUrl(slug)}`);
  } catch {
    return null;
  }
}

/**
 * The file under the page's space's `_assets/` a destination names, decoded
 * and without a query or fragment, or null for anything else. The portable
 * `_assets/…` is what the renderer scopes to the space; a path that reaches
 * the same folder some other way, `/<space>/_assets/…` or `../_assets/…`, is
 * that file too. Each one found is noted for the download.
 */
function assetOf(dest: string, ex: Export): string | null {
  let asset: string | null = null;
  if (dest.startsWith("_assets/")) {
    asset = decodePath(dest.slice("_assets/".length).replace(/[?#].*$/s, ""));
  } else if (!leavesKb(dest) && ex.space) {
    const path = slugOfPath(pageRelative(dest, ex.slug)?.pathname ?? "");
    const prefix = `${ex.space}/_assets/`;
    if (path.startsWith(prefix)) asset = path.slice(prefix.length);
  }
  if (!asset) return null;
  ex.assets.add(asset);
  return asset;
}

/** A file's `_assets/…` destination, each part of its path encoded. */
function assetHref(asset: string): string {
  return `_assets/${asset.split("/").map(encodeURIComponent).join("/")}`;
}

/** A percent-encoded path, decoded; one with a stray % is taken as written. */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** A value safe inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A page's path on the server, each segment encoded as the renderer does. */
function pageUrl(slug: string): string {
  return "/" + slug.split("/").map(encodeURIComponent).join("/");
}

/** The slug a server path names. */
function slugOfPath(pathname: string): string {
  return decodePath(pathname).replace(/^\/+|\/+$/g, "");
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
