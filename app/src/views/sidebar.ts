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
  <div class="sidebar-top">${PAGE_NAV}<a class="brand" href="/">${escapeHtml(siteTitle)}</a></div>
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
  <div class="sidebar-top">${PAGE_NAV}<a class="brand" href="/">${escapeHtml(siteTitle)}</a></div>
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
