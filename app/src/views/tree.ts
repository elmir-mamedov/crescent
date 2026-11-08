import type { PageNode } from "../content.js";
import { newFolderButton, renameFolderButton } from "./folders.js";
import { escapeHtml, slugPath } from "./html.js";

/**
 * The page tree in the sidebar: its rows and their menus, the script that opens
 * it where the reader left it, and the one that moves pages by dragging them.
 */

/**
 * The sidebar tree. `parentSlug` is the group being rendered (a space key at the
 * top level) and is what the insertion lines report on a drop.
 */
export function renderTree(
  nodes: PageNode[],
  activeSlug: string,
  options: {
    archiveMode?: boolean;
    dragEnabled?: boolean;
    collapsible?: boolean;
    parentSlug?: string;
  } = {}
): string {
  if (nodes.length === 0) return "";
  const parentSlug = options.parentSlug ?? "";
  // One zero-height insertion point above every row plus one closing the group,
  // so document order matches the sequence of positions on screen — MOVE_SCRIPT
  // relies on that to turn "the top edge of this row" into a drop target. Each is
  // invisible until dragged at, so a tree at rest looks exactly as it did.
  const dropLine = (before: string): string =>
    options.dragEnabled && parentSlug
      ? `<li class="drop-line" data-drop-line data-drop-parent="${escapeHtml(parentSlug)}"${
          before ? ` data-drop-before="${escapeHtml(before)}"` : ""
        }></li>`
      : "";
  const items = nodes
    .map((n) => {
      const isActive = n.slug === activeSlug;
      // aria-current names the row a reader is on, which the highlight colour
      // alone cannot. The class keeps its exact spelling and slot: MOVE_SCRIPT
      // and COPY_LINK_SCRIPT both select `.tree a.active[data-drag-slug]`.
      const activeAttrs = isActive ? ' class="active" aria-current="page"' : "";
      const dragAttrs = options.dragEnabled
        ? ` draggable="true" data-drag-slug="${escapeHtml(n.slug)}" data-drop-slug="${escapeHtml(n.slug)}"`
        : "";
      const label =
        options.archiveMode && !n.archived
          ? `<span class="tree-label">${escapeHtml(n.title)}</span>`
          : `<a href="${slugPath(n.slug)}"${activeAttrs}${dragAttrs}>${escapeHtml(n.title)}</a>`;
      const hasChildren = n.children.length > 0;
      // Only the open page's branch renders expanded: its ancestors, so its row
      // is on screen, and the page itself, so its children are listed. Every
      // other group starts shut, and a view with no open page starts with the
      // whole tree shut. Rendered here rather than by script, so nothing a reader
      // opened on the previous page carries over and the tree never flashes open.
      const collapsed = !!options.collapsible && hasChildren && !containsSlug(n, activeSlug);
      // Every row opens with one 18px marker column holding exactly one glyph, so
      // an expandable row's caret lands on the same vertical as a sibling leaf's
      // dot instead of a column to its left. Expanding or collapsing swaps the
      // caret's rotation, never its slot, so nothing shifts sideways.
      const toggle = options.collapsible && hasChildren
        ? `<button type="button" class="tree-toggle" aria-label="Toggle subpages" aria-expanded="${collapsed ? "false" : "true"}"></button>`
        : "";
      // A content page with no caret of its own fills the marker column with a
      // dot, so it reads unambiguously as a standalone page. Folders get a spacer
      // there instead — their own icon follows in the next column.
      const marker = toggle
        ? toggle
        : n.isFolder
          ? `<span class="tree-toggle-spacer"></span>`
          : PAGE_DOT;
      // Only real folders (pure containers) carry the folder icon, so it reads
      // as "container" — distinct from an ordinary content page that merely
      // happens to have child pages.
      const folderIcon = n.isFolder ? FOLDER_ICON : "";
      // The fresh mark comes after the title, never in the marker column: that
      // column holds exactly one glyph per row, which keeps carets and leaf dots
      // aligned.
      const fresh = options.archiveMode ? "" : freshMark(n);
      const row = options.dragEnabled
        ? `<div class="tree-row">${marker}${folderIcon}${label}${fresh}${treeMenu(n)}</div>`
        : label;
      const children = hasChildren
        ? `<div class="children">${renderTree(n.children, activeSlug, {
            ...options,
            parentSlug: n.slug,
          })}</div>`
        : "";
      return `${dropLine(n.slug)}<li data-tree-slug="${escapeHtml(n.slug)}"${collapsed ? ' class="collapsed"' : ""}>${row}${children}</li>`;
    })
    .join("");
  return `<ul>${items}${dropLine("")}</ul>`;
}

/** Whether `slug` is `node` itself or one of its descendants. */
function containsSlug(node: PageNode, slug: string): boolean {
  return node.slug === slug || node.children.some((c) => containsSlug(c, slug));
}

/**
 * What a sidebar row shows after its title: a glowing dot on a page nobody has
 * opened yet, whoever added it, or, on a group that is shut, a ring when such a
 * page is folded away inside it. The ring is drawn on every group with
 * a fresh page below and CSS shows it only while the group is collapsed, so a
 * caret click hides and shows it with no script. A row that is fresh itself
 * shows only the dot, which already draws the eye to it.
 *
 * Label dots used to sit here; labels now show in the page header, the label
 * dialog and the dashboards, and the sidebar keeps this one signal.
 */
function freshMark(node: PageNode): string {
  if (node.fresh) return markHtml(FRESH_MARK);
  return node.children.some(hasFresh) ? markHtml(FRESH_WITHIN_MARK) : "";
}

/** The two marks, which UNREAD_SCRIPT also draws when a page is marked unread. */
const FRESH_MARK = {
  className: "tree-fresh",
  label: "New, not opened yet",
  title: "New — this page has not been opened yet",
};
const FRESH_WITHIN_MARK = {
  className: "tree-fresh-within",
  label: "Contains new pages",
  title: "Contains new pages that have not been opened yet",
};

function markHtml(mark: typeof FRESH_MARK): string {
  return `<span class="${mark.className}" role="img" aria-label="${escapeHtml(mark.label)}" title="${escapeHtml(mark.title)}"></span>`;
}

function hasFresh(node: PageNode): boolean {
  return !!node.fresh || node.children.some(hasFresh);
}

/**
 * Per-node ⋯ menu. Every node can hold children (New page / New folder). A
 * folder is a pure container, so it gets a Rename control and NO Edit/Download;
 * ordinary pages keep Edit/Download and a "Labels" item that opens the shared
 * label dialog. Naming a new folder and renaming one happen in the shared folder
 * dialog. A page that has been opened can be marked unread again (UNREAD_SCRIPT),
 * so one opened by accident gets its dot back.
 */
function treeMenu(node: PageNode): string {
  const slug = node.slug;
  const newPage = `<form method="post" action="/_create">
        <input type="hidden" name="parentSlug" value="${escapeHtml(slug)}" />
        <button type="submit">New page</button>
      </form>`;
  const newFolder = newFolderButton(slug, node.title, "New folder");
  // Folders: rename the display name (in the folder dialog). Pages: edit body /
  // download.
  const middle = node.isFolder
    ? renameFolderButton(slug, node.title, "Rename")
    : `<a href="/_edit${slugPath(slug)}">Edit</a>
      <a href="/_download${slugPath(slug)}" download>Download</a>
      <button type="button" data-label-open data-label-slug="${escapeHtml(slug)}" data-label-title="${escapeHtml(node.title)}" data-label-current="${escapeHtml(JSON.stringify(node.labels ?? []))}">Labels</button>`;
  // Only a page can be new (markFresh), and one already showing its dot is
  // unread as it is.
  const markUnread =
    !node.isFolder && node.id && !node.fresh
      ? `\n      <button type="button" data-mark-unread="${escapeHtml(slug)}">Mark as unread</button>`
      : "";
  return `<details class="tree-menu">
    <summary aria-label="Page actions">⋯</summary>
    <div class="tree-menu-pop">
      ${newPage}
      ${newFolder}
      ${middle}
      <button type="button" data-copy-slug="${escapeHtml(slug)}">Copy link</button>${markUnread}
      <form method="post" action="/_archive${slugPath(slug)}">
        <button type="submit">Archive</button>
      </form>
      <a href="/_delete${slugPath(slug)}">Delete</a>
    </div>
  </details>`;
}

/** Inline folder glyph prefixed to section rows in the sidebar tree. */
export const FOLDER_ICON = `<svg class="tree-folder-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1.75 4c0-.69.56-1.25 1.25-1.25h2.94c.33 0 .65.13.88.37l.87.88c.05.04.11.07.18.07H13c.69 0 1.25.56 1.25 1.25v6.06c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z"/></svg>`;

/** Inline dot glyph prefixed to leaf-page rows (a content page with no children). */
const PAGE_DOT = `<svg class="tree-page-dot" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>`;

/**
 * Puts the sidebar tree in the shape it is read in: groups opened by hand come
 * back on a reload of the same page, and the open page's row is scrolled into
 * the sidebar's view. Emitted inside the <aside>, straight after the tree,
 * rather than with MOVE_SCRIPT at the end of <body>: a browser may paint while
 * it is still parsing the article and the scripts below it, and a sidebar
 * painted before this ran showed the top of the tree for a frame, then
 * jumped. SIDEBAR_RENDER_HOLD keeps Chromium from painting until the marker
 * after this script, by which point it has run; elsewhere, running this early
 * leaves only the tree's own parse for a paint to land in.
 *
 * MOVE_SCRIPT owns the rest of the collapse behaviour: the carets and the
 * hand-off it writes as the page goes away.
 */
export const TREE_PLACE_SCRIPT = `
(() => {
  // The reload hand-off lasts exactly one load: it is removed by the next page
  // to start, whether or not that page is the reload it was meant for.
  const EXPANDED_KEY = "kb:expanded";
  try {
    const saved = JSON.parse(sessionStorage.getItem(EXPANDED_KEY) || "null");
    sessionStorage.removeItem(EXPANDED_KEY);
    const nav = performance.getEntriesByType("navigation")[0];
    if (saved && saved.url === location.href && nav && nav.type === "reload") {
      const reopened = new Set(saved.slugs);
      for (const li of document.querySelectorAll(".tree li.collapsed[data-tree-slug]")) {
        if (!reopened.has(li.getAttribute("data-tree-slug"))) continue;
        li.classList.remove("collapsed");
        const toggle = li.querySelector(":scope > .tree-row .tree-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "true");
      }
    }
  } catch {}

  // Revealing a row is pointless if it sits outside the sidebar's scroll box.
  // Measured after the reopening above, because a reopened group can push this
  // row down. The overflow test skips trees that already fit and skips the
  // narrow layout, where .sidebar is static and scrolling would move the window
  // instead -- pulling the reader off the page they just opened. scrollTop, not
  // scrollIntoView, for the same reason.
  const activeLink = document.querySelector(".tree a.active");
  const pane = document.querySelector(".sidebar");
  if (activeLink && pane && pane.scrollHeight > pane.clientHeight) {
    const row = activeLink.closest(".tree-row") || activeLink;
    const paneBox = pane.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < paneBox.top || rowBox.bottom > paneBox.bottom) {
      pane.scrollTop += rowBox.top - paneBox.top - (pane.clientHeight - rowBox.height) / 2;
    }
  }
})();
`;

/**
 * Marking a page unread from its ⋯ menu (feedback #12): the server forgets it
 * was opened, and its row gets the dot back, with the ring on each group above
 * it, drawn here rather than by a reload. Reloading the page that was marked
 * would open it again, for the server counts every load of a page as opening
 * it.
 *
 * For the same reason, a mark on the open page is handed on to every reload of
 * this view, which marks it unread again before the tree first paints: the
 * change feed reloads a page whenever its space changes, and an agent writing
 * pages there would otherwise take the dot straight back off. Any other load
 * ends the hand-off, as opening the page anew is meant to. Emitted inside the
 * <aside>, straight after TREE_PLACE_SCRIPT, for the same reason that is.
 */
export const UNREAD_SCRIPT = `
(() => {
  const tree = document.querySelector(".tree");
  if (!tree) return;
  const KEPT_KEY = "kb:kept-unread";
  const MARK = ${JSON.stringify(FRESH_MARK)};
  const WITHIN = ${JSON.stringify(FRESH_WITHIN_MARK)};

  function markNode(mark) {
    const node = document.createElement("span");
    node.className = mark.className;
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", mark.label);
    node.title = mark.title;
    return node;
  }

  function rowOf(li) {
    return li.querySelector(":scope > .tree-row");
  }

  /** The marks renderTree draws for a page nobody has opened, after its title. */
  function draw(li) {
    const row = rowOf(li);
    if (!row) return;
    const button = row.querySelector("[data-mark-unread]");
    if (button) button.remove();
    if (row.querySelector(":scope > ." + MARK.className)) return;
    // A row with its own dot never shows the ring as well.
    const ring = row.querySelector(":scope > ." + WITHIN.className);
    if (ring) ring.remove();
    row.insertBefore(markNode(MARK), row.querySelector(":scope > .tree-menu"));
    for (let up = li.parentElement.closest("li[data-tree-slug]"); up; up = up.parentElement.closest("li[data-tree-slug]")) {
      const upRow = rowOf(up);
      if (!upRow || upRow.querySelector(":scope > ." + MARK.className + ", :scope > ." + WITHIN.className)) continue;
      upRow.insertBefore(markNode(WITHIN), upRow.querySelector(":scope > .tree-menu"));
    }
  }

  function rowFor(slug) {
    for (const li of tree.querySelectorAll("li[data-tree-slug]")) {
      if (li.getAttribute("data-tree-slug") === slug) return li;
    }
    return null;
  }

  function fail(message) {
    const box = document.querySelector("[data-move-error]");
    if (!box) return;
    box.textContent = message || "Could not mark the page unread.";
    box.hidden = false;
    window.setTimeout(() => {
      box.hidden = true;
    }, 5000);
  }

  /** True once the server has it unread; says why not otherwise. */
  async function markUnread(slug) {
    try {
      const response = await fetch("/_unread/" + slug.split("/").map(encodeURIComponent).join("/"), {
        method: "POST",
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result && result.ok) return true;
      fail(result && result.error);
    } catch {
      fail();
    }
    return false;
  }

  function isOpen(li) {
    return !!(li && li.querySelector(":scope > .tree-row a.active[data-drag-slug]"));
  }

  let kept = null;
  try {
    kept = JSON.parse(sessionStorage.getItem(KEPT_KEY) || "null");
    const nav = performance.getEntriesByType("navigation")[0];
    if (!kept || kept.url !== location.href || !nav || nav.type !== "reload") {
      kept = null;
      sessionStorage.removeItem(KEPT_KEY);
    }
  } catch {
    kept = null;
  }
  const keptRow = kept && rowFor(kept.slug);
  if (keptRow && isOpen(keptRow)) {
    draw(keptRow);
    markUnread(kept.slug).then((ok) => {
      if (ok) return;
      try {
        sessionStorage.removeItem(KEPT_KEY);
      } catch {}
    });
  }

  tree.addEventListener("click", async (event) => {
    const button = event.target.closest && event.target.closest("[data-mark-unread]");
    if (!button) return;
    const slug = button.getAttribute("data-mark-unread") || "";
    const li = button.closest("li[data-tree-slug]");
    const menu = button.closest(".tree-menu");
    if (menu) menu.open = false;
    if (!slug || !li || !(await markUnread(slug))) return;
    draw(li);
    if (!isOpen(li)) return;
    try {
      sessionStorage.setItem(KEPT_KEY, JSON.stringify({ url: location.href, slug }));
    } catch {}
  });
})();
`;

export const MOVE_SCRIPT = `
(() => {
  const treeEl = document.querySelector(".tree");
  const orderedLinks = Array.from(document.querySelectorAll(".tree a[data-drag-slug]"));
  // Rows inside the tree are resolved from the pointer (see resolveDrop), which
  // has to decide between "into this page" and "between these two" for the same
  // pixel. Only targets outside the tree — the space name — keep own listeners.
  const dropTargets = Array.from(
    document.querySelectorAll("[data-drop-slug], [data-drop-root]")
  ).filter((el) => !treeEl || !treeEl.contains(el));
  const errorEl = document.querySelector("[data-move-error]");

  // Multi-selection, for dragging several pages at once (feedback #18): the
  // first shift-click selects that page alone and anchors the range, and each
  // shift-click after it selects everything from the anchor to the page
  // clicked. Cmd/Ctrl-click opens a page in a new tab instead (TABS_SCRIPT).
  // State is in-memory only — it just needs to survive from the click until
  // the drag, and navigation reloads.
  const selected = new Set();
  let anchorIndex = -1;
  let dragSlugs = [];

  function slugOf(el) {
    return el.getAttribute("data-drag-slug") || "";
  }

  function sourceParent(slug) {
    const parts = slug.split("/");
    parts.pop();
    return parts.join("/");
  }

  function applySelection() {
    for (const el of orderedLinks) {
      el.classList.toggle("selected", selected.has(slugOf(el)));
    }
  }

  // Rows inside a collapsed group are skipped: a range covers what the reader
  // can see between the two clicks, not the pages folded away under it.
  function selectRange(a, b) {
    selected.clear();
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi; i++) {
      if (orderedLinks[i].offsetParent !== null) selected.add(slugOf(orderedLinks[i]));
    }
    applySelection();
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    window.setTimeout(() => {
      errorEl.hidden = true;
    }, 5000);
  }

  let activeLine = null;

  function clearTargets() {
    for (const target of dropTargets) target.classList.remove("drop-target-active");
    for (const el of orderedLinks) el.classList.remove("drop-target-active");
    if (activeLine) {
      activeLine.classList.remove("drop-line-active");
      activeLine = null;
    }
  }

  function invalidDrop(target) {
    if (dragSlugs.length === 0) return true;
    if (target.hasAttribute("data-drop-root")) {
      // Valid only if at least one dragged item is nested (has a parent to leave).
      return !dragSlugs.some((s) => s.includes("/"));
    }

    const targetSlug = target.getAttribute("data-drop-slug") || "";
    if (!targetSlug) return true;
    for (const s of dragSlugs) {
      if (targetSlug === s) return true; // onto itself
      if (targetSlug.startsWith(s + "/")) return true; // into a descendant
    }
    // Pure no-op: every dragged item already lives directly under the target.
    if (dragSlugs.every((s) => sourceParent(s) === targetSlug)) return true;
    return false;
  }

  // --- Insertion lines --------------------------------------------------------
  // Rows and insertion lines in document order, which is exactly their order on
  // screen. Rebuilt at dragstart, so rows hidden inside a collapsed group are left
  // out and "the line after this row" never points somewhere invisible.
  let seq = [];
  const EDGE = 6;

  function isLine(el) {
    return el.classList.contains("drop-line");
  }

  function buildSeq() {
    seq = treeEl
      ? Array.from(treeEl.querySelectorAll(".drop-line, .tree-row")).filter(
          (el) => el.offsetParent !== null
        )
      : [];
  }

  function indexOfSlug(slug) {
    return orderedLinks.findIndex((el) => slugOf(el) === slug);
  }

  /** The nearest insertion line before (dir -1) or after (dir 1) a row. */
  function neighborLine(row, dir) {
    let i = seq.indexOf(row);
    if (i < 0) return null;
    for (i += dir; i >= 0 && i < seq.length; i += dir) {
      if (isLine(seq[i])) return seq[i];
    }
    return null;
  }

  /**
   * What the pointer is over: an insertion line when it is within EDGE px of a
   * row's top or bottom, the row itself (= move into that page) anywhere in
   * between, or the line closing the tree once the pointer is past the last row.
   * Lines are zero-height and paint through a pseudo-element, so they are never
   * hit directly — a line drop is always inferred from the row edge under the
   * cursor.
   *
   * Where two groups end at the same height — a nested group's closing line sits
   * level with the line following its parent row — the row whose edge is being
   * touched decides, which is why each is looked up in document order from that
   * row: a group's own lines always neighbour its own rows. So the last nested
   * child's bottom edge appends inside the nested group, while the top edge of the
   * row below it, one pixel further down, lands in the outer one.
   */
  function resolveDrop(event) {
    const node = event.target;
    const row = node && node.closest ? node.closest(".tree-row") : null;
    if (row && seq.indexOf(row) >= 0) {
      const rect = row.getBoundingClientRect();
      const edge = Math.min(EDGE, rect.height / 3);
      const before = event.clientY - rect.top <= edge ? neighborLine(row, -1) : null;
      if (before) return { line: before };
      const after = rect.bottom - event.clientY <= edge ? neighborLine(row, 1) : null;
      if (after) return { line: after };
      const link = row.querySelector("a[data-drop-slug]");
      return link ? { row: link } : null;
    }

    // Past the last row (the tree's trailing padding): append to the top level,
    // which is the last line of all. Overshooting a drag aimed at the end of the
    // sidebar is common, and it should land rather than fall through.
    const rows = seq.filter((el) => !isLine(el));
    const lastRow = rows[rows.length - 1];
    const lines = seq.filter(isLine);
    const lastLine = lines[lines.length - 1];
    if (lastRow && lastLine && event.clientY > lastRow.getBoundingClientRect().bottom) {
      return { line: lastLine };
    }
    return null;
  }

  function invalidLine(line) {
    if (dragSlugs.length === 0) return true;
    const parent = line.getAttribute("data-drop-parent") || "";
    if (!parent) return true;
    for (const s of dragSlugs) {
      // Into itself or one of its own descendants.
      if (parent === s || parent.indexOf(s + "/") === 0) return true;
    }
    // A lone page dropped on the line directly above or below itself stays put.
    if (dragSlugs.length === 1) {
      const link = orderedLinks[indexOfSlug(dragSlugs[0])];
      const row = link ? link.closest(".tree-row") : null;
      if (row && (line === neighborLine(row, -1) || line === neighborLine(row, 1))) {
        return true;
      }
    }
    return false;
  }

  function highlight(el, cls) {
    if (el.classList.contains(cls)) return;
    clearTargets();
    el.classList.add(cls);
    if (cls === "drop-line-active") activeLine = el;
  }

  async function post(url, body, failure) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        showError(result.error || failure);
        return null;
      }
      return result;
    } catch {
      showError(failure);
      return null;
    }
  }

  /** Drop onto a page or the space name: re-parent, then land on the moved page. */
  async function submitMove(target) {
    const isRoot = target.hasAttribute("data-drop-root");
    const targetSlug = isRoot ? "" : target.getAttribute("data-drop-slug") || "";
    // Skip items already parented at the target — the server rejects no-ops.
    const slugs = isRoot
      ? dragSlugs.slice()
      : dragSlugs.filter((s) => sourceParent(s) !== targetSlug);
    if (slugs.length === 0) return;
    const result = await post(
      "/_move",
      new URLSearchParams({
        sourceSlugs: JSON.stringify(slugs),
        targetKind: isRoot ? "root" : "page",
        targetSlug,
      }),
      "Move failed."
    );
    if (!result) return;
    if (window.kbTabs) window.kbTabs.moved(result.moved);
    if (result.error) {
      // Partial success: show the note briefly, then land on a moved page.
      showError(result.error);
      window.setTimeout(() => {
        window.location.href = result.url;
      }, 2000);
      return;
    }
    window.location.href = result.url;
  }

  /** Drop onto an insertion line: place the pages at that exact spot. */
  async function submitReorder(line) {
    const result = await post(
      "/_reorder",
      new URLSearchParams({
        sourceSlugs: JSON.stringify(dragSlugs),
        parentSlug: line.getAttribute("data-drop-parent") || "",
        beforeSlug: line.getAttribute("data-drop-before") || "",
      }),
      "Could not reorder pages."
    );
    if (!result) return;
    if (window.kbTabs) window.kbTabs.moved(result.moved);
    if (result.error) {
      showError(result.error);
      window.setTimeout(() => settle(result), 2000);
      return;
    }
    settle(result);
  }

  /**
   * Arranging pages must not navigate away — the reader keeps the page they are
   * reading, and a reload is what re-renders the sidebar in its new order. The
   * exception is the page they are on having moved: then follow it to its new URL.
   */
  function settle(result) {
    const activeEl = document.querySelector(".tree a.active[data-drag-slug]");
    const current = activeEl ? slugOf(activeEl) : "";
    const moved = Array.isArray(result.moved) ? result.moved : [];
    for (const m of moved) {
      if (current === m.oldSlug || current.indexOf(m.oldSlug + "/") === 0) {
        const next = m.newSlug + current.slice(m.oldSlug.length);
        window.location.href = "/" + next.split("/").map(encodeURIComponent).join("/");
        return;
      }
    }
    window.location.reload();
  }

  orderedLinks.forEach((link, index) => {
    link.addEventListener("click", (event) => {
      // Opens the page in a new tab, and leaves the selection alone.
      if (event.metaKey || event.ctrlKey) return;
      if (event.shiftKey) {
        event.preventDefault();
        if (anchorIndex < 0 || selected.size === 0) anchorIndex = index;
        selectRange(anchorIndex, index);
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      } else {
        // Plain click navigates; drop any lingering selection first.
        selected.clear();
        anchorIndex = -1;
        applySelection();
      }
    });

    link.addEventListener("dragstart", (event) => {
      const slug = slugOf(link);
      // Grabbing a selected item drags the whole selection; else just this one.
      let slugs = selected.has(slug) && selected.size > 0 ? Array.from(selected) : [slug];
      // Drop descendants of another dragged slug — the ancestor carries them.
      slugs = slugs.filter((s) => !slugs.some((o) => o !== s && s.startsWith(o + "/")));
      // Sidebar order, so a multi-page drop lands in the order it was shown in.
      slugs.sort((a, b) => indexOfSlug(a) - indexOfSlug(b));
      dragSlugs = slugs;
      buildSeq();
      for (const el of orderedLinks) {
        if (dragSlugs.includes(slugOf(el))) el.classList.add("drag-source");
      }
      document.body.classList.add("dragging-page");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", dragSlugs.join("\\n"));
      }
    });

    link.addEventListener("dragend", () => {
      dragSlugs = [];
      for (const el of orderedLinks) el.classList.remove("drag-source");
      document.body.classList.remove("dragging-page");
      clearTargets();
    });
  });

  for (const target of dropTargets) {
    target.addEventListener("dragover", (event) => {
      if (invalidDrop(target)) {
        target.classList.remove("drop-target-active");
        return;
      }

      event.preventDefault();
      highlight(target, "drop-target-active");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    target.addEventListener("dragleave", () => {
      target.classList.remove("drop-target-active");
    });

    target.addEventListener("drop", (event) => {
      if (invalidDrop(target)) return;
      event.preventDefault();
      clearTargets();
      submitMove(target);
    });
  }

  // One handler for the whole tree: which of the two gestures a drop is — into a
  // page, or between two of them — depends on where in a row the pointer sits, so
  // it cannot be split across per-element listeners.
  if (treeEl) {
    treeEl.addEventListener("dragover", (event) => {
      const hit = resolveDrop(event);
      if (!hit) {
        clearTargets();
        return;
      }
      if (hit.line ? invalidLine(hit.line) : invalidDrop(hit.row)) {
        clearTargets();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      if (hit.line) highlight(hit.line, "drop-line-active");
      else highlight(hit.row, "drop-target-active");
    });

    treeEl.addEventListener("dragleave", (event) => {
      if (!treeEl.contains(event.relatedTarget)) clearTargets();
    });

    treeEl.addEventListener("drop", (event) => {
      const hit = resolveDrop(event);
      if (!hit) return;
      if (hit.line ? invalidLine(hit.line) : invalidDrop(hit.row)) return;
      event.preventDefault();
      clearTargets();
      if (hit.line) submitReorder(hit.line);
      else submitMove(hit.row);
    });
  }

  const menus = Array.from(document.querySelectorAll(".tree-menu"));
  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      for (const other of menus) {
        if (other !== menu) other.open = false;
      }
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus) {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    }
  });

  // Collapsible sidebar tree. The server renders only the open page's branch
  // expanded (renderTree), so a caret click lasts for this page view and every
  // navigation starts over from the new page's branch alone. The exception is a
  // reload of the same page -- after a reorder, a label change, or F5 -- which
  // re-renders what the reader is already looking at and so keeps the groups
  // they opened by hand. That hand-off is written here as the page goes away;
  // TREE_PLACE_SCRIPT reads it back before the tree first paints.
  const EXPANDED_KEY = "kb:expanded";
  // 0.7.1 and earlier remembered every collapsed group here indefinitely.
  try {
    localStorage.removeItem("kb:collapsed");
  } catch {}

  function setExpanded(li, toggle, expanded) {
    li.classList.toggle("collapsed", !expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  const groups = [];
  for (const li of document.querySelectorAll(".tree li[data-tree-slug]")) {
    const toggle = li.querySelector(":scope > .tree-row .tree-toggle");
    if (!toggle) continue;
    const slug = li.getAttribute("data-tree-slug") || "";
    groups.push({ li, slug });
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(li, toggle, li.classList.contains("collapsed"));
    });
  }
  window.addEventListener("pagehide", () => {
    const slugs = groups.filter((g) => !g.li.classList.contains("collapsed")).map((g) => g.slug);
    try {
      sessionStorage.setItem(EXPANDED_KEY, JSON.stringify({ url: location.href, slugs }));
    } catch {}
  });
})();
`;
