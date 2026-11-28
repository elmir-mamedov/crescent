/**
 * Download ▸ Website (feedback #81): a page and every page under it, or a whole
 * space, as a zip of static HTML anyone can read without crescent. Put it on
 * any web host, or open its index.html from disk.
 *
 * Each page is rendered by crescent's own renderer, so it reads as it does in
 * crescent: math, Mermaid diagrams, images, widgets, collapsible sections and
 * tabs included. It is read only, and it carries none of crescent's own
 * tools: no editing, chat, labels, tags, notes, search or feedback. A sidebar
 * lists the exported pages, the theme follows the reader's system, and a
 * footer says it was made with crescent.
 *
 * Every link between exported pages, `[[id:…]]` links and links to a section
 * included, becomes a relative path to that page's file, so the site works
 * from any folder or host. A link to a page left out becomes its text.
 *
 * A static host sends a file with nothing but its type, none of the headers
 * crescent keeps a space's files harmless with (assets.ts), so the site holds
 * no file of the space a browser could run as the host's own page. A file
 * that can't run, an image, a sound, a video, a text or a PDF (the list
 * crescent shows in place, INLINE_EXTENSIONS), goes in `_assets/` under the
 * name it has in the space. An SVG picture goes into its page as a `data:`
 * image, where an `<img>` runs none of its script, and a widget into its
 * page's frame as `srcdoc`, sandboxed as crescent shows it, so neither is a
 * file anyone could open on its own. A link to any other file becomes its
 * text. KaTeX's stylesheet and fonts, and Mermaid, go in `_crescent/` only
 * when a page needs them, with the licenses they and crescent's own files
 * come under.
 *
 * Laid out by slug under the exported page: that page is `index.html`, a page
 * with pages under it is `<path>/index.html`, and any other page `<path>.html`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { INLINE_EXTENSIONS, isWidgetName } from "./assets.js";
import { isFolderPage, type Content, type PageNode } from "./content.js";
import { createRenderer } from "./markdown.js";
import { copiedNotices } from "./third-party-notices.js";
import { stripNotes } from "./notes.js";
import { escapeHtml } from "./views/html.js";
import {
  UNREADABLE_PAGE,
  folderListing,
  relativeHref,
  sitePage,
  siteStylesheet,
  siteWidget,
  type SitePage,
} from "./views/site.js";
import { WIDGET_SIZE_LIMIT } from "./server/widgets.js";
import { zip, type ZipEntry } from "./zip.js";

/** The exported site: its file name and the zip itself. */
export interface SiteDownload {
  filename: string;
  body: Buffer;
}

/**
 * The pages a site of `root` holds, `root` first, in the sidebar's order, and
 * each one's file: `index.html` for the root, `<path>/index.html` for a page
 * with pages under it, `<path>.html` for the rest.
 */
export function sitePages(root: PageNode): SitePage {
  const fileFor = (node: PageNode): string => {
    if (node.slug === root.slug) return "index.html";
    const rel = node.slug.slice(root.slug.length + 1);
    return node.children.length ? `${rel}/index.html` : `${rel}.html`;
  };
  const walk = (node: PageNode): SitePage => ({
    slug: node.slug,
    title: node.title,
    file: fileFor(node),
    children: node.children.map(walk),
  });
  return walk(root);
}

/** Every page of a site, depth first. */
export function flatten(page: SitePage): SitePage[] {
  return [page, ...page.children.flatMap(flatten)];
}

/** What rewriting a page's HTML needs to know of the site. */
export interface Rewrite {
  /** The page's slug, which a relative link is read against, as on its address in crescent. */
  slug: string;
  /** The page's own file. */
  file: string;
  /** The space the pages are in, whose `_assets/` their files come from. */
  space: string;
  /** Each exported page's file by its slug. */
  files: Map<string, string>;
  /** The `_assets/` files the site copies, decoded, filled in as it goes. */
  assets: Set<string>;
  /** The SVG pictures its pages show, by their `_assets/` name, filled in as it goes. */
  svgs: Set<string>;
  /** The widgets its pages show, by their `_assets/` name, filled in as it goes. */
  widgets: Set<string>;
}

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** The HTML attribute value as it reads, for the few entities escapeHtml writes. */
function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** A path under the space's `_assets/`, decoded and tidied, or null. */
function assetName(rest: string): string | null {
  const name = decode(rest);
  if (name === null) return null;
  const parts = name.split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

type Target =
  | { kind: "keep" }
  | { kind: "drop" }
  | { kind: "to"; href: string }
  | { kind: "svg"; name: string }
  | { kind: "widget"; name: string };

/**
 * Where a link (`as` "link"), a picture ("image") or a widget's frame
 * ("frame") that crescent wrote leads in the exported site.
 */
function target(raw: string, rw: Rewrite, as: "link" | "image" | "frame"): Target {
  let url = unescapeAttr(raw);
  if (url.startsWith("//") || url.startsWith("#") || url.startsWith("?") || /^[a-z][a-z\d+.-]*:/i.test(url)) {
    return { kind: "keep" };
  }
  if (!url.startsWith("/")) {
    // A relative address (`[next](step-two)`, `[up](../intro)`), read the way
    // a browser reads it on the page's own address in crescent.
    const base = new URL(`http://crescent.invalid/${rw.slug.split("/").map(encodeURIComponent).join("/")}`);
    const resolved = new URL(url, base);
    url = resolved.pathname + resolved.hash;
  }
  const hashAt = url.indexOf("#");
  const pathPart = (hashAt < 0 ? url : url.slice(0, hashAt)).replace(/\?.*$/, "");
  const hash = hashAt < 0 ? "" : url.slice(hashAt);

  const embed = `/_embed/${encodeURIComponent(rw.space)}/_assets/`;
  if (pathPart.startsWith(embed)) {
    const name = assetName(pathPart.slice(embed.length));
    if (!name || as !== "frame" || !isWidgetName(name)) return { kind: "drop" };
    rw.widgets.add(name);
    return { kind: "widget", name };
  }
  const assets = `/${rw.space}/_assets/`;
  if (pathPart.startsWith(assets)) {
    const name = assetName(pathPart.slice(assets.length));
    if (!name) return { kind: "drop" };
    const ext = path.posix.extname(name).toLowerCase();
    if (INLINE_EXTENSIONS.has(ext)) {
      rw.assets.add(name);
      return { kind: "to", href: relativeHref(rw.file, `_assets/${name}`) + hash };
    }
    if (as === "image" && ext === ".svg") {
      rw.svgs.add(name);
      return { kind: "svg", name };
    }
    return { kind: "drop" };
  }
  if (as !== "link") return { kind: "drop" };
  const slug = decode(pathPart.slice(1).replace(/\/+$/, ""));
  const file = slug === null ? undefined : rw.files.get(slug);
  if (file === undefined) return { kind: "drop" };
  return { kind: "to", href: relativeHref(rw.file, file) + hash };
}

/** An attribute's value in a tag, as written (escaped), or null. */
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/**
 * A page's HTML, as crescent's renderer wrote it, for the exported site: each
 * link and source that leads into crescent points to its file in the site,
 * or, for a page or file left out, becomes its text; a relative link is read
 * as crescent's own address for the page would read it. An SVG picture and a
 * widget are marked (`data-site-svg`, `data-site-widget`) for `fillEmbeds`
 * to put inside the page. The attributes crescent's own scripts read (where
 * each block came from, the section links' copy targets) go, and a section
 * link, which only jumps to its heading here, says so.
 */
export function rewriteHtml(html: string, rw: Rewrite): string {
  const linked = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (whole, attrs: string, inner: string) => {
    const href = /\shref="([^"]*)"/.exec(attrs);
    if (!href) return whole;
    const to = target(href[1], rw, "link");
    if (to.kind === "keep") return whole;
    if (to.kind !== "to") return `<span class="site-unlinked">${inner}</span>`;
    return `<a${attrs.replace(href[0], () => ` href="${escapeHtml(to.href)}"`)}>${inner}</a>`;
  });
  const pictured = linked.replace(/<img\b[^>]*>/g, (tag) => {
    const src = attr(tag, "src");
    if (src === null) return tag;
    const to = target(src, rw, "image");
    if (to.kind === "keep") return tag;
    if (to.kind === "to") return tag.replace(` src="${src}"`, () => ` src="${escapeHtml(to.href)}"`);
    if (to.kind === "svg") return tag.replace(` src="${src}"`, () => ` data-site-svg="${escapeHtml(to.name)}"`);
    return `<span class="site-unlinked">${attr(tag, "alt") ?? ""}</span>`;
  });
  const framed = pictured.replace(/<iframe\b[^>]*>(?:<\/iframe>)?/g, (tag) => {
    const src = attr(tag, "src");
    if (src === null) return tag;
    const to = target(src, rw, "frame");
    if (to.kind === "keep") return tag;
    if (to.kind === "widget") return tag.replace(` src="${src}"`, () => ` data-site-widget="${escapeHtml(to.name)}"`);
    return `<span class="site-unlinked">${attr(tag, "title") ?? ""}</span>`;
  });
  return framed
    .replace(/\sdata-(?:src-line|src-hash|copy-slug|copy-label)="[^"]*"/g, "")
    .replace(/(<a class="section-link"[^>]*\saria-label=")Copy link to section: /g, "$1Link to section: ");
}

/**
 * Put the pictures and widgets `rewriteHtml` marked into the page: an SVG as
 * a `data:` image, and a widget as its frame's `srcdoc`, escaped into the
 * attribute. One the site has no copy of (gone, or a widget over crescent's
 * size limit) is left empty.
 */
export function fillEmbeds(html: string, svgs: Map<string, Buffer>, widgets: Map<string, string>): string {
  return html
    .replace(/\sdata-site-svg="([^"]*)"/g, (_whole, name: string) => {
      const data = svgs.get(unescapeAttr(name));
      return ` src="${data ? `data:image/svg+xml;base64,${data.toString("base64")}` : ""}"`;
    })
    .replace(/\sdata-site-widget="([^"]*)"/g, (_whole, name: string) => {
      const doc = widgets.get(unescapeAttr(name));
      return ` srcdoc="${escapeHtml(doc ?? "")}"`;
    });
}

function findNode(nodes: readonly PageNode[], slug: string): PageNode | undefined {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const below = findNode(node.children, slug);
    if (below) return below;
  }
  return undefined;
}

/** The first of `files` that is there, read, or null. */
async function firstFile(files: string[]): Promise<Buffer | null> {
  for (const file of files) {
    try {
      return await fs.readFile(file);
    } catch {
      /* try the next */
    }
  }
  return null;
}

/**
 * The licenses the site's own files come under, in `_crescent/`: crescent's,
 * for its stylesheet and scripts, and, when the site carries KaTeX or
 * Mermaid, theirs. A release keeps crescent's LICENSE and NOTICE beside the
 * app, and THIRD_PARTY_NOTICES.txt, which covers KaTeX, Mermaid and what
 * Mermaid carries inside it; a checkout keeps the first two a folder up, and
 * the third is written from its node_modules, as a release's is.
 */
async function licenseEntries(appDir: string, uses: { katex: boolean; mermaid: boolean }): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  for (const name of ["LICENSE", "NOTICE"]) {
    const data = await firstFile([path.join(appDir, name), path.join(appDir, "..", name)]);
    if (data) entries.push({ name: `_crescent/${name}`, data });
  }
  if (!uses.katex && !uses.mermaid) return entries;
  const notices = await firstFile([path.join(appDir, "THIRD_PARTY_NOTICES.txt")]);
  if (notices) {
    entries.push({ name: "_crescent/THIRD_PARTY_NOTICES.txt", data: notices });
    return entries;
  }
  const names = (["katex", "mermaid"] as const).filter((pkg) => uses[pkg]);
  entries.push({ name: "_crescent/THIRD_PARTY_NOTICES.txt", data: Buffer.from(copiedNotices(appDir, names), "utf8") });
  return entries;
}

/** The file name a site downloads as: its root's leaf, then `-website.zip`. */
export function siteFilename(slug: string): string {
  const leaf = slug.split("/").filter(Boolean).at(-1) ?? "";
  return `${leaf || "site"}-website.zip`;
}

/**
 * The site of the page `slug` and every live page under it, as a zip; null
 * when there is no live page there. `appDir` is the app's folder, whose
 * `node_modules` holds the KaTeX and Mermaid files a page may need.
 */
export async function exportSite(
  content: Pick<Content, "tree" | "load" | "titleIndex" | "idIndex" | "resolveAsset" | "spaceKeyOf">,
  slug: string,
  appDir: string
): Promise<SiteDownload | null> {
  const space = content.spaceKeyOf(slug);
  const [tree, titles, ids] = await Promise.all([content.tree("live"), content.titleIndex(), content.idIndex()]);
  const root = findNode(tree, slug.replace(/^\/+|\/+$/g, ""));
  if (!space || !root) return null;

  const site = sitePages(root);
  const pages = flatten(site);
  const files = new Map(pages.map((page) => [page.slug, page.file]));
  const assets = new Set<string>();
  const svgs = new Set<string>();
  const widgets = new Set<string>();
  const rendered: { page: SitePage; html: string }[] = [];

  for (const page of pages) {
    // One page whose header can't be read keeps its place in the site, with
    // a note, rather than failing the whole download.
    const loaded = await content.load(page.slug).catch(() => "unreadable" as const);
    let html: string;
    if (!loaded) {
      // A folder with no index.md: the sidebar lists it, so it gets its listing.
      html = folderListing(page);
    } else if (loaded === "unreadable") {
      html = UNREADABLE_PAGE;
    } else if (isFolderPage(loaded.data)) {
      html = folderListing(page);
    } else {
      const md = createRenderer((s) => titles.get(s), page.slug, (id) => ids.get(id));
      html = rewriteHtml(md.render(stripNotes(loaded.body)), { slug: page.slug, file: page.file, space, files, assets, svgs, widgets });
    }
    rendered.push({ page, html });
  }

  // resolveAsset refuses a path that climbs out of `_assets/` or passes a
  // dotted or linked part, so only the space's own files go in. A picture or
  // widget is read whole into each page that shows it, so one past
  // crescent's widget limit is left out, as crescent leaves out that widget.
  const read = async (name: string): Promise<Buffer | null> => {
    const fsPath = await content.resolveAsset(space, name);
    if (!fsPath || (await fs.stat(fsPath)).size > WIDGET_SIZE_LIMIT) return null;
    return fs.readFile(fsPath);
  };
  const svgData = new Map<string, Buffer>();
  for (const name of svgs) {
    const data = await read(name);
    if (data) svgData.set(name, data);
  }
  const widgetDocs = new Map<string, string>();
  for (const name of widgets) {
    const data = await read(name);
    if (data) widgetDocs.set(name, siteWidget(data.toString("utf8")));
  }

  const entries: ZipEntry[] = [];
  const katex = rendered.some(({ html }) => html.includes('class="katex'));
  const mermaid = rendered.some(({ html }) => html.includes('class="mermaid"'));
  for (const { page, html } of rendered) {
    const usesWidgets = html.includes('class="widget-frame"');
    const whole = sitePage({
      site,
      page,
      contentHtml: fillEmbeds(html, svgData, widgetDocs),
      katex: katex && html.includes('class="katex'),
      mermaid: mermaid && html.includes('class="mermaid"'),
      widgets: usesWidgets,
    });
    entries.push({ name: page.file, data: Buffer.from(whole, "utf8") });
  }

  entries.push({ name: "_crescent/crescent.css", data: Buffer.from(siteStylesheet(), "utf8") });
  if (katex) {
    const dist = path.join(appDir, "node_modules", "katex", "dist");
    entries.push({ name: "_crescent/katex/katex.min.css", data: await fs.readFile(path.join(dist, "katex.min.css")) });
    for (const font of await fs.readdir(path.join(dist, "fonts"))) {
      if (!/^[\w-]+\.woff2$/.test(font)) continue;
      entries.push({ name: `_crescent/katex/fonts/${font}`, data: await fs.readFile(path.join(dist, "fonts", font)) });
    }
  }
  if (mermaid) {
    const file = path.join(appDir, "node_modules", "mermaid", "dist", "mermaid.min.js");
    entries.push({ name: "_crescent/mermaid.min.js", data: await fs.readFile(file) });
  }

  entries.push(...(await licenseEntries(appDir, { katex, mermaid })));

  for (const name of assets) {
    const fsPath = await content.resolveAsset(space, name);
    if (fsPath) entries.push({ name: `_assets/${name}`, data: await fs.readFile(fsPath) });
  }

  return { filename: siteFilename(root.slug), body: zip(entries) };
}
