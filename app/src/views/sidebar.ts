import { flatten, type PageNode, type SpaceInfo } from "../content.js";
import { knownLabels, type LabelDef } from "../labels.js";
import { folderDialog, newFolderButton } from "./folders.js";
import { archiveHref, escapeHtml, slugPath } from "./html.js";
import { labelDialog } from "./labels.js";
import { SEARCH_SCRIPT, sidebarSearch } from "./search.js";
import { PAGE_NAV } from "./tabs.js";
import { TREE_PLACE_SCRIPT, UNREAD_SCRIPT, renderTree } from "./tree.js";

/**
 * The sidebar: the space switcher, the search box, the Create menu, the archive
 * link, the page tree and the dialogs its rows open, and the hold that keeps a
 * page from painting before its tree is in place.
 */

export function sidebarHtml(
  siteTitle: string,
  spaces: SpaceInfo[],
  spaceKey: string,
  tree: PageNode[],
  activeSlug: string,
  isArchiveView = false,
  labelSet: readonly LabelDef[] = []
): string {
  // Outside any space (a 404): just list the spaces. Each space keeps its own
  // archive (feedback #28), so there is none to link to here.
  if (!spaceKey) {
    const list = spaces.length
      ? `<ul>${spaces
          .map(
            (s) =>
              `<li><a href="${slugPath(s.key)}">${escapeHtml(
                s.icon ? `${s.icon} ${s.title}` : s.title
              )}</a></li>`
          )
          .join("")}</ul>`
      : "";
    return `<aside class="sidebar">
  <div class="sidebar-top">${PAGE_NAV}<a class="brand" href="/">${escapeHtml(siteTitle)}</a>${SIDEBAR_HIDE_BUTTON}</div>
  <nav class="tree">${list}</nav>
  ${SIDEBAR_PLACED_MARKER}
</aside>`;
  }

  const current = spaces.find((s) => s.key === spaceKey);
  const spaceLabel = current
    ? current.icon
      ? `${current.icon} ${current.title}`
      : current.title
    : spaceKey;
  // The space name doubles as the "move to space root" drop target, taking over
  // from the dashed strip that this sidebar's search box replaced. It carries
  // `data-drop-slug` (not `data-drop-root`, which would mean the KB root, outside
  // any space) so MOVE_SCRIPT picks it up with no change and the semantics stay
  // exactly what the old strip had: targetKind "page", targetSlug = the space.
  const rootDropAttrs = ` data-drop-slug="${escapeHtml(spaceKey)}" title="Drop a page here to move it to the space root"`;
  const switcher = `<div class="space-switcher">
    <a class="space-current" href="${slugPath(spaceKey)}"${rootDropAttrs}>${escapeHtml(spaceLabel)}</a>
    <a class="space-all" href="/">↩ All spaces</a>
  </div>`;
  // MOVE_SCRIPT still writes every drag failure into [data-move-error]; it used
  // to sit beside the removed drop strip, so it keeps its slot above the tree.
  const moveError = `<div class="move-error" data-move-error hidden></div>`;
  // The space's own archive; its page keeps this sidebar, and marks the link.
  const archiveCurrent = isArchiveView ? ' aria-current="page"' : "";

  // The labels a person can pick in this space — the palette, then orphans the
  // pages carry — shared by the search filter and the label dialog.
  const offered = knownLabels(labelSet, flatten(tree)).map(({ name, color, defined }) => ({
    name,
    color,
    defined,
  }));

  return `<aside class="sidebar">
  <div class="sidebar-top">${PAGE_NAV}<a class="brand" href="/">${escapeHtml(siteTitle)}</a>${SIDEBAR_HIDE_BUTTON}</div>
  ${switcher}
  ${sidebarSearch(spaceKey, offered)}
  <details class="create-menu">
    <summary class="sidebar-link">Create</summary>
    <div class="create-menu-pop">
      <form method="post" action="/_create">
        <input type="hidden" name="parentSlug" value="${escapeHtml(spaceKey)}" />
        <button type="submit">Page</button>
      </form>
      ${newFolderButton(spaceKey, current?.title ?? spaceKey, "Folder")}
    </div>
  </details>
  <a class="sidebar-link${isArchiveView ? " active" : ""}" href="${archiveHref(spaceKey)}"${archiveCurrent}>Archive</a>
  ${moveError}
  <nav class="tree">${renderTree(tree, activeSlug, {
    dragEnabled: true,
    collapsible: true,
    parentSlug: spaceKey,
  })}</nav>
  <script>${TREE_PLACE_SCRIPT}</script>
  <script>${UNREAD_SCRIPT}</script>
  ${SIDEBAR_PLACED_MARKER}
</aside>
<script>${SEARCH_SCRIPT}</script>
${labelDialog(spaceKey, offered)}
${folderDialog()}`;
}

/** A panel with its left column marked: the sidebar, in both of its buttons. */
const SIDEBAR_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M6.25 2.75v10.5"/></svg>`;

/**
 * Hide sidebar, at the end of the sidebar's top row, and Show sidebar, among
 * the corner's tools (corner.ts), which shows only while the sidebar is hidden
 * on a view that has one. Hidden, the sidebar leaves its width to the page,
 * which on a narrow window is what lets the page and the chat sit side by side.
 * Both flip the same switch (SIDEBAR_STATE_SCRIPT).
 */
const SIDEBAR_HIDE_BUTTON = `<button type="button" class="page-nav-button sidebar-toggle" data-sidebar-toggle aria-label="Hide sidebar" title="Hide sidebar">${SIDEBAR_ICON}</button>`;
export const SIDEBAR_SHOW_BUTTON = `<button type="button" class="sidebar-show" data-sidebar-toggle aria-label="Show sidebar" title="Show sidebar">${SIDEBAR_ICON}</button>`;

/**
 * Whether the sidebar is hidden, kept in localStorage (`kb25.sidebar`) since
 * every view is a page load of its own, and put on <html> as `sidebar-hidden`
 * from <head> (head.ts), before the body paints, so a page opened with the
 * sidebar hidden never shows it first. One click handler on the document
 * serves every [data-sidebar-toggle].
 */
export const SIDEBAR_STATE_SCRIPT = `
(() => {
  const KEY = "kb25.sidebar";
  const root = document.documentElement;
  try {
    if (localStorage.getItem(KEY) === "hidden") root.classList.add("sidebar-hidden");
  } catch (e) {}
  document.addEventListener("click", (event) => {
    const target = event.target;
    const button = target && target.closest ? target.closest("[data-sidebar-toggle]") : null;
    if (!button) return;
    event.preventDefault();
    const hidden = root.classList.toggle("sidebar-hidden");
    try {
      if (hidden) localStorage.setItem(KEY, "hidden");
      else localStorage.removeItem(KEY);
    } catch (e) {}
  });
})();
`;

/**
 * Holds the first paint until the sidebar has been parsed (Chromium; other
 * browsers ignore it), so a page never shows its tree before TREE_PLACE_SCRIPT
 * has opened and scrolled it. Chromium lifts the hold as soon as the expected
 * element is inserted, not when it closes, so the target is an empty marker
 * after that script rather than the <aside> itself. The sidebar comes first in
 * <body>, so the hold costs nothing of the page itself. Only for views that
 * render a sidebar: without the marker, the hold would last the whole parse.
 */
const SIDEBAR_PLACED_ID = "kb-sidebar-placed";
export const SIDEBAR_RENDER_HOLD = `\n<link rel="expect" href="#${SIDEBAR_PLACED_ID}" blocking="render" />`;
const SIDEBAR_PLACED_MARKER = `<span id="${SIDEBAR_PLACED_ID}" hidden></span>`;
