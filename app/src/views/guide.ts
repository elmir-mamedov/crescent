import { DIAGRAM_VIEWER, MERMAID_SCRIPT } from "./diagrams.js";
import { renderHead } from "./head.js";
import { escapeHtml } from "./html.js";

/**
 * The getting-started guide as Help shows it (guide.ts): crescent's own copy,
 * read-only. It has none of a page's controls, so nothing on it can change or
 * delete it, and its sidebar lists only the guide's pages.
 */

export interface GuidePageLink {
  /** Where the page is shown: `/_guide/…`. */
  href: string;
  title: string;
}

export interface GuideView {
  title: string;
  /** The page, rendered with links that stay inside the guide. */
  contentHtml: string;
  /** The guide's pages in reading order, its start page first. */
  pages: GuidePageLink[];
  /** The href of the page shown, to mark it in the sidebar. */
  activeHref: string;
}

/** KaTeX's stylesheet, as page.ts links it. */
const KATEX_CSS = `<link rel="stylesheet" href="/_vendor/katex/katex.min.css" />`;

export function guideLayout(v: GuideView): string {
  const list = v.pages
    .map((page) => {
      const active = page.href === v.activeHref ? ' class="active" aria-current="page"' : "";
      return `<li><a href="${escapeHtml(page.href)}"${active}>${escapeHtml(page.title)}</a></li>`;
    })
    .join("");
  const mathCss = v.contentHtml.includes('class="katex') ? `\n${KATEX_CSS}` : "";
  const hasDiagram = v.contentHtml.includes('class="mermaid"');

  return `<!doctype html>
<html lang="en">
${renderHead(`${escapeHtml(v.title)} · crescent guide`, mathCss)}
<body class="guide">
<aside class="sidebar">
  <div class="sidebar-top"><a class="brand" href="/">crescent</a></div>
  <nav class="tree" aria-label="Guide"><ul>${list}</ul></nav>
</aside>
<main class="content">
  <div class="notice">This is crescent's built-in guide: it can't be changed or deleted, and every update of crescent brings it up to date. <a href="/">Back to your knowledge base</a></div>
  <header class="page-head"><div><h1>${escapeHtml(v.title)}</h1></div></header>
  <article class="prose">${v.contentHtml}</article>
</main>
${hasDiagram ? DIAGRAM_VIEWER : ""}
${hasDiagram ? MERMAID_SCRIPT : ""}
</body>
</html>`;
}
