/**
 * The pages of Download ▸ Website (site-export.ts): the exported site's page
 * template, its stylesheet and theme script, a folder's listing, and a widget
 * as its frame carries it. What the site holds, and where each page and file
 * goes, is site-export.ts's.
 */
import path from "node:path";
import { BLOCKS_SCRIPT } from "./blocks.js";
import { MERMAID_SCRIPT } from "./diagrams.js";
import { escapeHtml } from "./html.js";
import { STYLES } from "./styles.js";
import { WIDGETS_SCRIPT, widgetDocument } from "./widgets.js";

/** The repository the footer links to. */
export const CRESCENT_URL = "https://github.com/elmir-mamedov/crescent";

/** One page of the site: where it came from and where it goes in the zip. */
export interface SitePage {
  slug: string;
  title: string;
  /** Its file, relative to the site's root, e.g. `guides/index.html`. */
  file: string;
  children: SitePage[];
}

/** The address of `to` from the file `from`, both relative to the site's root. */
export function relativeHref(from: string, to: string): string {
  const rel = path.posix.relative(path.posix.dirname(from), to) || path.posix.basename(to);
  return rel
    .split("/")
    .map((part) => (part === ".." ? part : encodeURIComponent(part)))
    .join("/");
}

/**
 * A widget as the site serves it: as crescent sends it to its frame, with the
 * network shut off by the page itself, as crescent's headers do (assets.ts).
 */
export function siteWidget(source: string): string {
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
  return widgetDocument(source).replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
  );
}

/** The site's own layout, on top of crescent's stylesheet. */
const SITE_STYLES = `
.site-nav ul{list-style:none; margin:0; padding:0}
.site-nav ul ul{padding-left:14px; border-left:1px solid var(--line); margin-left:8px}
.site-nav a{display:block; padding:4px 8px; border-radius:6px; color:var(--fg-secondary); font-size:14px; line-height:1.4}
.site-nav a:hover{background:var(--surface-hover); text-decoration:none}
.site-nav a[aria-current="page"]{background:var(--active-bg); color:var(--accent); font-weight:600}
.site-nav .brand{font-size:15px; padding:0 8px; margin-bottom:14px}
.site-footer{margin-top:48px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:13px}
.site-folder{padding-left:1.2em}
.site-unreadable{color:var(--muted); font-style:italic}
@media (max-width:780px){
  body{display:block}
  .sidebar{position:static; width:auto; height:auto; border-right:0; border-bottom:1px solid var(--line)}
  .content{padding:24px 20px}
}
@media print{.sidebar,.site-footer{display:none}}
`;

/**
 * The theme the reader's system asks for, on <html> before the page paints,
 * kept up as it changes, with diagrams drawn again in it.
 */
const SITE_THEME_SCRIPT = `(() => {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const wear = () => {
    document.documentElement.dataset.theme = dark.matches ? "dark" : "light";
    if (typeof window.__renderMermaid === "function") window.__renderMermaid();
  };
  wear();
  dark.addEventListener("change", wear);
})();`;

function navList(page: SitePage, current: string): string {
  const here = page.file === current ? ' aria-current="page"' : "";
  const link = `<a href="${escapeHtml(relativeHref(current, page.file))}"${here}>${escapeHtml(page.title)}</a>`;
  const below = page.children.length
    ? `<ul>${page.children.map((child) => navList(child, current)).join("")}</ul>`
    : "";
  return `<li>${link}${below}</li>`;
}

/** One page of the site, whole. */
export function sitePage(v: {
  site: SitePage;
  page: SitePage;
  contentHtml: string;
  katex: boolean;
  mermaid: boolean;
  widgets: boolean;
}): string {
  const to = (file: string) => escapeHtml(relativeHref(v.page.file, file));
  const title = v.page === v.site ? v.site.title : `${v.page.title} · ${v.site.title}`;
  const nav = v.site.children.length ? `<ul>${v.site.children.map((child) => navList(child, v.page.file)).join("")}</ul>` : "";
  const here = v.page === v.site ? ' aria-current="page"' : "";
  const mermaid = v.mermaid
    ? MERMAID_SCRIPT.replace('src="/_vendor/mermaid/mermaid.min.js"', `src="${to("_crescent/mermaid.min.js")}"`)
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${to("_crescent/crescent.css")}" />${
    v.katex ? `\n<link rel="stylesheet" href="${to("_crescent/katex/katex.min.css")}" />` : ""
  }
<script>${SITE_THEME_SCRIPT}</script>
</head>
<body>
<nav class="sidebar site-nav" aria-label="Pages">
  <a class="brand" href="${to(v.site.file)}"${here}>${escapeHtml(v.site.title)}</a>
  ${nav}
</nav>
<main class="content">
  <header class="page-head"><div><h1>${escapeHtml(v.page.title)}</h1></div></header>
  <article class="prose">${v.contentHtml}</article>
  <footer class="site-footer">Made with <a href="${CRESCENT_URL}">crescent</a></footer>
</main>
${/class="(details|tabs)-block"/.test(v.contentHtml) ? `<script>${BLOCKS_SCRIPT}</script>` : ""}
${v.widgets ? `<script>${WIDGETS_SCRIPT}</script>` : ""}
${mermaid}
</body>
</html>
`;
}

/** The listing a folder, which has no text of its own, shows in the site. */
export function folderListing(page: SitePage): string {
  if (!page.children.length) return "<p>This folder is empty.</p>";
  const items = page.children
    .map((child) => `<li><a href="${escapeHtml(relativeHref(page.file, child.file))}">${escapeHtml(child.title)}</a></li>`)
    .join("");
  return `<ul class="site-folder">${items}</ul>`;
}

/** The site's stylesheet, `_crescent/crescent.css`: crescent's own, and the site's layout on top. */
export function siteStylesheet(): string {
  return STYLES + SITE_STYLES;
}

/** What a page whose header can't be read shows in the site, in place of its text. */
export const UNREADABLE_PAGE = `<p class="site-unreadable">This page's header couldn't be read, so its text isn't in this copy. Fix it in crescent and download the website again.</p>`;
