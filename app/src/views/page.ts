import type { PageNode, SpaceInfo } from "../content.js";
import type { LabelDef } from "../labels.js";
import type { RenderedNote, Section } from "../markdown.js";
import { sessionCorner } from "./corner.js";
import { DIAGRAM_VIEWER, MERMAID_SCRIPT } from "./diagrams.js";
import { FIND_BAR, FIND_SCRIPT } from "./find.js";
import { newFolderButton, renameFolderButton } from "./folders.js";
import { renderHead } from "./head.js";
import { escapeHtml, slugPath } from "./html.js";
import { labelChips } from "./labels.js";
import { NOTES_SCRIPT } from "./notes.js";
import { downloadMenu, PRINT_SCRIPT } from "./print.js";
import { SIDEBAR_RENDER_HOLD, sidebarHtml } from "./sidebar.js";
import { tabStrip } from "./tabs.js";
import { FOLDER_ICON, MOVE_SCRIPT, renderTree } from "./tree.js";

/**
 * A page as the reader sees it (layout), and the views drawn the same way: a
 * folder's contents, a space's archive, and the page that isn't there. Also the
 * parts other layouts share: the breadcrumb, the copy-link button and the "On this
 * page" rail.
 */

export function breadcrumb(slug: string, titles: Map<string, string>): string {
  if (!slug) return "";
  const parts = slug.split("/");
  const crumbs: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const title = titles.get(acc) ?? part;
    crumbs.push(`<a href="/${acc}">${escapeHtml(title)}</a>`);
  }
  return `<nav class="crumbs"><a href="/">Spaces</a> ${crumbs
    .map((c) => `<span class="sep">/</span> ${c}`)
    .join(" ")}</nav>`;
}

export interface PageView {
  siteTitle: string;
  /** Full space list for the switcher. */
  spaces: SpaceInfo[];
  /** Active space key ("" outside any space, e.g. the archive browser). */
  spaceKey: string;
  /** Navigation subtree for the active space (scoped, not the whole KB). */
  tree: PageNode[];
  activeSlug: string;
  titles: Map<string, string>;
  title: string;
  /** The page's own labels, shown as chips under the title. */
  labels?: string[];
  /** The active space's label palette, for the chips, the search filter and the label dialog. */
  labelSet?: LabelDef[];
  tags?: string[];
  contentHtml: string;
  /**
   * The page's headings, for the "On this page" rail. Already filtered to the
   * levels the rail shows — `tableOfContents` renders whatever it is given.
   */
  sections?: Section[];
  /** Inline notes saved on this page; the renderer has already anchored them. */
  notes?: RenderedNote[];
  updated?: string | null;
  canEdit?: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  /** A space's archive: the sidebar marks its Archive link, and no page is open. */
  isArchiveView?: boolean;
  notice?: ViewNotice;
  username?: string | null;
}

export interface ArchiveView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  spaceTitle: string;
  /** The space's navigation, for the sidebar. */
  tree: PageNode[];
  labelSet?: LabelDef[];
  /** Its archived pages, under the folders that hold them. */
  archiveTree: PageNode[];
  titles: Map<string, string>;
  username?: string | null;
}

export interface ViewNotice {
  tone: "error" | "success" | "warning";
  text: string;
}

function actionForm(actionPrefix: string, slug: string, label: string, variant: string): string {
  return `<form class="action-form" method="post" action="${actionPrefix}${slugPath(slug)}">
    <button class="button ${variant}" type="submit">${escapeHtml(label)}</button>
  </form>`;
}

/**
 * Page-header "Copy link" button. Copies the page's relative address — the slug,
 * which starts with the space key and ends with the leaf (e.g. `kb25/backlog`).
 * `data-copy-slug` carries the value copied by the delegated `COPY_LINK_SCRIPT`
 * handler; `data-copy-link` marks it as the current page's button so the
 * keyboard shortcut can find it.
 */
function copyLinkButton(slug: string): string {
  return `<button type="button" class="button secondary" data-copy-slug="${escapeHtml(slug)}" data-copy-link>Copy link</button>`;
}

/**
 * The "On this page" rail: the page's headings, indented by level.
 *
 * Rendered as a third column beside the sidebar and the content rather than
 * inside `.content`, so the prose keeps its full measure. A page with only one
 * section gets no rail — a table of contents listing a single entry is noise.
 *
 * `data-depth` carries the indent instead of nested `<ul>`s because the scroll
 * script walks the entries as one flat list, and `data-section` is the anchor it
 * matches against. Deliberately no `white-space:nowrap` anywhere in here: `body`
 * is a flex row, so nowrap raises this column's min-content width and widens the
 * whole page instead of ellipsising.
 */
function tableOfContents(sections: Section[]): string {
  if (sections.length < 2) return "";
  const top = Math.min(...sections.map((s) => s.level));
  const items = sections
    .map((s) => {
      const href = escapeHtml("#" + encodeURIComponent(s.anchor));
      return (
        `<li class="toc-item" data-depth="${s.level - top}">` +
        `<a href="${href}" data-section="${escapeHtml(s.anchor)}">${escapeHtml(s.text)}</a>` +
        `</li>`
      );
    })
    .join("");
  return `<aside class="toc" aria-label="On this page">
  <div class="toc-head">On this page</div>
  <ul class="toc-list">${items}</ul>
</aside>`;
}

export function layout(v: PageView): string {
  const tags = (v.tags ?? [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");
  const updated = v.updated
    ? `<div class="updated">Updated ${escapeHtml(v.updated)}</div>`
    : "";
  // Labels lead the meta line: a person set them, so they say more about the
  // page than the keyword tags beside them.
  const labels = labelChips(v.labels ?? [], v.labelSet ?? [], v.spaceKey);
  const metaInner = `${labels ? `<div class="page-labels">${labels}</div>` : ""}${tags ? `<div class="tags">${tags}</div>` : ""}${updated}`;
  const editLink =
    v.canEdit === false
      ? ""
      : `<a class="button secondary" href="/_edit${slugPath(v.activeSlug)}" data-edit-link>Edit</a>`;
  const diffLink =
    v.canEdit === false || !v.activeSlug
      ? ""
      : `<a class="button secondary" href="/_diff${slugPath(v.activeSlug)}">Diff</a>`;
  const downloadLink =
    v.canEdit === false || !v.activeSlug ? "" : downloadMenu(v.activeSlug);
  const copyLink =
    v.canEdit === false || !v.activeSlug ? "" : copyLinkButton(v.activeSlug);
  const archiveAction =
    v.canEdit === false || v.isArchived || !v.activeSlug
      ? ""
      : actionForm("/_archive", v.activeSlug, "Archive", "danger");
  const restoreAction =
    v.isArchived && v.activeSlug
      ? actionForm("/_restore", v.activeSlug, "Restore", "primary")
      : "";
  const deleteAction =
    v.canEdit === false || !v.activeSlug
      ? ""
      : `<a class="button danger" href="/_delete${slugPath(v.activeSlug)}">Delete</a>`;
  const archivedAt = v.archivedAt ? ` on ${escapeHtml(v.archivedAt)}` : "";
  const archivedBanner = v.isArchived
    ? `<div class="notice archived"><strong>Archived.</strong> This page is hidden from normal navigation${archivedAt}.</div>`
    : "";
  const notice = v.notice
    ? `<div class="notice ${v.notice.tone}">${escapeHtml(v.notice.text)}</div>`
    : "";
  const toc = tableOfContents(v.sections ?? []);
  // Shipped even when there are no notes yet, because it also carries the slug
  // the composer posts to — the reader can always start the first one.
  const notesData =
    v.canEdit === false || v.isArchiveView || !v.activeSlug
      ? ""
      : `<div id="kb25-notes" hidden data-slug="${escapeHtml(v.activeSlug)}" data-notes="${escapeHtml(JSON.stringify(v.notes ?? []))}"></div>`;

  // In <head> rather than beside the Mermaid script: KaTeX's markup without its
  // stylesheet shows every formula twice, once as text and once as MathML.
  const mathCss = v.contentHtml.includes('class="katex') ? `\n${KATEX_CSS}` : "";

  return `<!doctype html>
<html lang="en">
${renderHead(`${escapeHtml(v.title)} · ${escapeHtml(v.siteTitle)}`, `${SIDEBAR_RENDER_HOLD}${mathCss}`)}
<body>
${sessionCorner(v.username, v.spaceKey, v.activeSlug)}
${tabStrip(v.title)}
${sidebarHtml(v.siteTitle, v.spaces, v.spaceKey, v.tree, v.activeSlug, v.isArchiveView, v.labelSet)}
<main class="content">
  ${breadcrumb(v.activeSlug, v.titles)}
  <header class="page-head">
    <div>
      <h1>${escapeHtml(v.title)}</h1>
      <div class="meta">${metaInner}</div>
    </div>
    <div class="actions">${editLink}${diffLink}${downloadLink}${copyLink}${archiveAction}${deleteAction}${restoreAction}</div>
  </header>
  ${notice}${archivedBanner}
  <article class="prose">${v.contentHtml}</article>
</main>
${toc}
${notesData}
${FIND_BAR}
<script>${FIND_SCRIPT}</script>
<script>${EDIT_SHORTCUT_SCRIPT}</script>
<script>${COPY_LINK_SCRIPT}</script>
<script>${PRINT_SCRIPT}</script>
${toc ? `<script>${TOC_SCRIPT}</script>` : ""}
${notesData ? `<script>${NOTES_SCRIPT}</script>` : ""}
<script>${MOVE_SCRIPT}</script>
${v.contentHtml.includes('class="mermaid"') ? `${DIAGRAM_VIEWER}\n${MERMAID_SCRIPT}` : ""}
</body>
</html>`;
}

export interface FolderView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  activeSlug: string;
  titles: Map<string, string>;
  title: string;
  /** The folder's direct children, rendered as the contents listing. */
  children: PageNode[];
  isArchived?: boolean;
  archivedAt?: string;
  notice?: ViewNotice;
  username?: string | null;
}

/**
 * A folder is a pure container: no prose body, no Edit/Download. This renders
 * its contents as a listing plus controls to create items inside it, rename it
 * (display name only), archive, or delete. Moving a folder is done by dragging
 * it in the sidebar, the same as pages. Its location is shown in the breadcrumb.
 */
export function folderLayout(v: FolderView): string {
  const listing = v.children.length
    ? `<ul class="folder-list">${v.children
        .map((c) => {
          const icon = c.isFolder ? FOLDER_ICON : "";
          return `<li>${icon}<a href="${slugPath(c.slug)}">${escapeHtml(c.title)}</a></li>`;
        })
        .join("")}</ul>`
    : `<p class="folder-empty">This folder is empty. Use “New page” or “New folder” to add items.</p>`;

  const createControls = v.isArchived
    ? ""
    : `<div class="folder-create">
      <form method="post" action="/_create">
        <input type="hidden" name="parentSlug" value="${escapeHtml(v.activeSlug)}" />
        <button class="button secondary" type="submit">New page</button>
      </form>
      ${newFolderButton(v.activeSlug, v.title, "New folder", "button secondary")}
    </div>`;

  const renameControl = v.isArchived
    ? ""
    : renameFolderButton(v.activeSlug, v.title, "Rename", "button secondary");
  const archiveAction = v.isArchived
    ? ""
    : actionForm("/_archive", v.activeSlug, "Archive", "danger");
  const restoreAction = v.isArchived
    ? actionForm("/_restore", v.activeSlug, "Restore", "primary")
    : "";
  const deleteAction = `<a class="button danger" href="/_delete${slugPath(v.activeSlug)}">Delete</a>`;
  const copyLink = copyLinkButton(v.activeSlug);

  const archivedAt = v.archivedAt ? ` on ${escapeHtml(v.archivedAt)}` : "";
  const archivedBanner = v.isArchived
    ? `<div class="notice archived"><strong>Archived.</strong> This folder is hidden from normal navigation${archivedAt}.</div>`
    : "";
  const notice = v.notice
    ? `<div class="notice ${v.notice.tone}">${escapeHtml(v.notice.text)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
${renderHead(`${escapeHtml(v.title)} · ${escapeHtml(v.siteTitle)}`, SIDEBAR_RENDER_HOLD)}
<body>
${sessionCorner(v.username, v.spaceKey, v.activeSlug)}
${tabStrip(v.title)}
${sidebarHtml(v.siteTitle, v.spaces, v.spaceKey, v.tree, v.activeSlug, false, v.labelSet)}
<main class="content">
  ${breadcrumb(v.activeSlug, v.titles)}
  <header class="page-head">
    <div>
      <h1>${escapeHtml(v.title)}</h1>
      <div class="meta"><span class="folder-tag">Folder</span></div>
    </div>
    <div class="actions">${copyLink}${renameControl}${archiveAction}${deleteAction}${restoreAction}</div>
  </header>
  ${notice}${archivedBanner}
  <section class="folder-view">
    ${createControls}
    ${listing}
  </section>
</main>
<script>${MOVE_SCRIPT}</script>
<script>${COPY_LINK_SCRIPT}</script>
</body>
</html>`;
}

/**
 * One space's archive: its archived pages, under the folders that hold them.
 * Every space keeps its own; there is no archive shared by all of them
 * (feedback #28). An archived page opens as itself, with its Restore button.
 */
export function archiveLayout(v: ArchiveView): string {
  const archiveHtml = v.archiveTree.length
    ? `<div class="archive-browser tree">${renderTree(v.archiveTree, "", {
        archiveMode: true,
      })}</div>`
    : `<p class="dash-empty">No archived pages in <strong>${escapeHtml(v.spaceTitle)}</strong>.</p>`;

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: "",
    titles: v.titles,
    title: `${v.spaceTitle} · Archive`,
    contentHtml: archiveHtml,
    canEdit: false,
    isArchiveView: true,
    username: v.username,
  });
}

export function notFound(
  siteTitle: string,
  slug: string,
  spaces: SpaceInfo[],
  username?: string | null
): string {
  return layout({
    siteTitle,
    spaces,
    spaceKey: "",
    tree: [],
    activeSlug: "",
    titles: new Map(),
    title: "Not found",
    contentHtml: `<p>No page exists at <code>/${escapeHtml(slug)}</code>.</p>`,
    canEdit: false,
    username,
  });
}

/**
 * Cmd/Ctrl+E opens the editor for the page being viewed. It reads the target
 * from the page's own Edit link, so it is inert on views without one (the
 * archive browser, 404s, system notices).
 */
const EDIT_SHORTCUT_SCRIPT = `
(() => {
  const link = document.querySelector("[data-edit-link]");
  if (!link) return;
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "e") return;
    event.preventDefault();
    window.location.href = link.href;
  });
})();
`;

/**
 * Copy-to-clipboard for anything addressable. Mostly a page's relative address —
 * its slug, which starts with the space key and ends with the leaf (e.g.
 * `kb25/backlog`) — so the copied string lives in `data-copy-slug`. Four entry
 * points share this one handler:
 *   1. Cmd/Ctrl+Shift+L copies the page being viewed.
 *   2. The sidebar ⋯ menu's "Copy link" copies that row's slug.
 *   3. The page-header "Copy link" button copies the current page.
 *   4. The dashboard's per-task button copies that note's `slug#id` reference.
 * The current page's button is also tagged `data-copy-link` so the shortcut can
 * find it (falling back to the active sidebar row on views without a header
 * button, e.g. the editor/history). Clipboard access degrades gracefully: it
 * prefers the async Clipboard API and falls back to a hidden-textarea
 * `execCommand("copy")` for non-secure origins (the default LAN host is plain
 * HTTP, where `navigator.clipboard` is absent).
 *
 * Every entry point confirms the same two ways: the control that was used tints
 * green or red, and a toast rises from the bottom of the window for a couple of
 * seconds. The toast is what covers the keyboard shortcut, whose target control
 * may be scrolled out of view or missing altogether. It names what was copied, so
 * a control that copies something other than a link says so via
 * `data-copy-label`; a control without one is copying a link.
 */
export const COPY_LINK_SCRIPT = `
(() => {
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => fallbackCopy(text)
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }
  // One toast, built up front rather than on first use: an aria-live region that
  // is inserted and filled in the same tick is unreliably announced, and having
  // it already laid out is what lets the first toast slide rather than appear.
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.appendChild(toast);
  let toastTimer = 0;

  function showToast(ok, label) {
    toast.textContent = ok ? (label || "Link") + " copied" : "Copy failed";
    toast.classList.toggle("is-error", !ok);
    window.clearTimeout(toastTimer);
    // Flip the class on the next frame so the browser has painted the offscreen
    // starting position and transitions into view instead of jumping.
    window.requestAnimationFrame(() => toast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2200);
  }

  // Tint the control that was clicked. The toast carries the wording, so this no
  // longer swaps the label — two "Copied" messages at once just read as noise.
  function flash(el, ok) {
    if (!el) return;
    el.classList.add(ok ? "copied" : "copy-failed");
    window.clearTimeout(el.__copyTimer);
    el.__copyTimer = window.setTimeout(() => {
      el.classList.remove("copied", "copy-failed");
    }, 1200);
  }
  function confirmCopy(el, ok, label) {
    flash(el, ok);
    showToast(ok, label);
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    const btn = target && target.closest ? target.closest("[data-copy-slug]") : null;
    if (!btn) return;
    event.preventDefault();
    const slug = btn.getAttribute("data-copy-slug") || "";
    const label = btn.getAttribute("data-copy-label");
    copyText(slug).then((ok) => confirmCopy(btn, ok, label));
    // A heading's copy control is also a real link to its own section. The
    // click was prevented above so the copy could run, so move the address bar
    // by hand — the reader who wanted the URL now sees it there too.
    const href = btn.getAttribute("href");
    if (href && href.charAt(0) === "#") location.hash = href.slice(1);
  });
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== "l") return;
    const pageBtn = document.querySelector("[data-copy-link]");
    const active = document.querySelector(".tree a.active[data-drag-slug]");
    const slug = pageBtn
      ? pageBtn.getAttribute("data-copy-slug")
      : active
      ? active.getAttribute("data-drag-slug")
      : null;
    if (!slug) return;
    event.preventDefault();
    // The shortcut can fire on views where the flashed control is offscreen or
    // absent entirely; the toast is what makes it confirmable there.
    copyText(slug).then((ok) => confirmCopy(pageBtn || active, ok));
  });
})();
`;

/**
 * Highlights the section the reader is currently in, in the "On this page" rail.
 *
 * A scroll listener rather than an IntersectionObserver: the question is "which
 * section am I in", and an observer answers "which headings are visible", which
 * is the wrong answer for a section taller than the viewport (no heading in
 * view, so nothing lights) and for the last section on a short page (it can
 * never reach the top). Instead every heading's position is measured against a
 * probe line just below the viewport top, and the last one at or above it wins.
 *
 * The window is what scrolls — only the sidebar has its own overflow — so
 * `getBoundingClientRect().top` is measured fresh on each pass rather than
 * cached, which keeps it correct after images load or a note popover opens.
 * Reads are throttled to one per animation frame; scroll fires far more often
 * than that and each pass touches every heading.
 *
 * An h3's parent h2 is lit too, so the section you are inside stays marked while
 * you read its subsections.
 */
const TOC_SCRIPT = `
(() => {
  const toc = document.querySelector(".toc");
  if (!toc) return;
  const links = Array.prototype.slice.call(toc.querySelectorAll("[data-section]"));
  if (!links.length) return;

  // Pair each rail entry with its heading once; the DOM order of the rail is
  // document order, which is what the "last one above the line" scan needs.
  const entries = [];
  for (const link of links) {
    const id = link.getAttribute("data-section") || "";
    let heading = null;
    try {
      heading = document.getElementById(id);
    } catch (e) {
      heading = null;
    }
    if (heading) entries.push({ link: link, heading: heading, item: link.parentElement });
  }
  if (!entries.length) return;

  let current = null;
  let queued = false;

  function mark(entry) {
    if (entry === current) return;
    for (const other of entries) {
      other.link.removeAttribute("aria-current");
      if (other.item) {
        other.item.removeAttribute("data-active");
        other.item.removeAttribute("data-current");
      }
    }
    current = entry;
    if (!entry) return;
    entry.link.setAttribute("aria-current", "location");
    if (entry.item) {
      entry.item.setAttribute("data-active", "true");
      entry.item.setAttribute("data-current", "true");
    }
    // Also light the nearest shallower entry above it, so an h3 keeps its h2 lit.
    const depth = entry.item ? Number(entry.item.getAttribute("data-depth") || "0") : 0;
    if (depth > 0) {
      const at = entries.indexOf(entry);
      for (let i = at - 1; i >= 0; i--) {
        const item = entries[i].item;
        if (!item) continue;
        if (Number(item.getAttribute("data-depth") || "0") < depth) {
          item.setAttribute("data-active", "true");
          break;
        }
      }
    }
  }

  function update() {
    queued = false;
    // The headings' scroll-margin-top, so the entry lights at the moment its
    // heading settles where a #link would have put it — plus a pixel of slack.
    // A jump to #section scrolls to the heading's offset minus that margin, and
    // the browser snaps the result to a whole pixel: a heading sitting on a
    // fraction then comes to rest a fraction *below* the line, and without the
    // slack the entry above it wins the section the reader just clicked. With
    // tabs open, the jump also clears their strip, the root's scroll-padding.
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const line = pad + 28 + 1;
    let found = null;
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top <= line) found = entry;
      else break;
    }
    // Above the first heading nothing is active; at the very bottom the last
    // section wins even if its heading never crosses the line.
    if (!found && window.scrollY <= 0) found = null;
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
      found = entries[entries.length - 1];
    }
    mark(found);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }

  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("hashchange", schedule);
})();
`;

/**
 * KaTeX's stylesheet, from the app's own copy (see `/_vendor/katex` in server/static.ts).
 * The formulas are already typeset into the page's HTML by markdown.ts; this and
 * the fonts it names are all a page needs to draw them.
 */
const KATEX_CSS = `<link rel="stylesheet" href="/_vendor/katex/katex.min.css" />`;
