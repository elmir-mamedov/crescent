import { flatten, type PageNode, type SpaceInfo } from "./content.js";
import { labelKey } from "./frontmatter.js";
import {
  LABEL_COLORS,
  colorOf,
  knownLabels,
  type KnownLabel,
  type LabelColor,
  type LabelDef,
} from "./labels.js";
import type { DiffLine } from "./diff.js";
import { IMAGE_ACCEPT, type GalleryImage } from "./gallery.js";
import { relativeAge, type NotePageGroup, type NoteSummary } from "./note-index.js";
import type { RenderedNote, Section } from "./markdown.js";

/** Set once at startup by {@link configureViews}; read by every page. */
let desktop = false;
let changeCursor: (() => string) | undefined;

/**
 * `desktop`: a launcher started this server (KB25_DESKTOP), so the corner
 * offers Quit (QUIT_SCRIPT) to a page in an ordinary browser tab.
 * `changeCursor`: where the KB's change feed is (changes.ts), which a page is
 * rendered with so that it follows the changes after it (CHANGES_SCRIPT).
 */
export function configureViews(options: { desktop: boolean; changeCursor?: () => string }): void {
  desktop = options.desktop;
  changeCursor = options.changeCursor;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The sidebar tree. `parentSlug` is the group being rendered (a space key at the
 * top level) and is what the insertion lines report on a drop.
 */
function renderTree(
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
 * Opens the folder dialog to create a folder inside `parentSlug`. The parent's
 * title rides along so the dialog can say where the folder will land.
 */
function newFolderButton(parentSlug: string, parentTitle: string, text: string, cls = ""): string {
  return `<button type="button"${cls ? ` class="${cls}"` : ""} data-folder-new data-folder-parent="${escapeHtml(parentSlug)}" data-folder-parent-title="${escapeHtml(parentTitle)}">${escapeHtml(text)}</button>`;
}

/** Opens the folder dialog to rename the folder at `slug`, prefilled with its title. */
function renameFolderButton(slug: string, title: string, text: string, cls = ""): string {
  return `<button type="button"${cls ? ` class="${cls}"` : ""} data-folder-rename data-folder-slug="${escapeHtml(slug)}" data-folder-title="${escapeHtml(title)}">${escapeHtml(text)}</button>`;
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
  if (node.fresh) {
    return `<span class="tree-fresh" role="img" aria-label="New, not opened yet" title="New — this page has not been opened yet"></span>`;
  }
  return node.children.some(hasFresh)
    ? `<span class="tree-fresh-within" role="img" aria-label="Contains new pages" title="Contains new pages that have not been opened yet"></span>`
    : "";
}

function hasFresh(node: PageNode): boolean {
  return !!node.fresh || node.children.some(hasFresh);
}

/**
 * Per-node ⋯ menu. Every node can hold children (New page / New folder). A
 * folder is a pure container, so it gets a Rename control and NO Edit/Download;
 * ordinary pages keep Edit/Download and a "Labels" item that opens the shared
 * label dialog. Naming a new folder and renaming one happen in the shared folder
 * dialog.
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
  return `<details class="tree-menu">
    <summary aria-label="Page actions">⋯</summary>
    <div class="tree-menu-pop">
      ${newPage}
      ${newFolder}
      ${middle}
      <button type="button" data-copy-slug="${escapeHtml(slug)}">Copy link</button>
      <form method="post" action="/_archive${slugPath(slug)}">
        <button type="submit">Archive</button>
      </form>
      <a href="/_delete${slugPath(slug)}">Delete</a>
    </div>
  </details>`;
}

function breadcrumb(slug: string, titles: Map<string, string>): string {
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
  isArchiveView?: boolean;
  notice?: ViewNotice;
  username?: string | null;
}

export interface EditView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  activeSlug: string;
  titles: Map<string, string>;
  title: string;
  raw: string;
  error?: string;
  notice?: string;
  username?: string | null;
  /**
   * Set when this is a space's instructions file. Swaps the slug-rename field
   * (renaming it would break the mechanism that finds it) for a character
   * counter, since the text is re-sent to the LLM on space-scoped tool results.
   */
  instructions?: { cap: number; spaceTitle: string };
}

export interface DiffView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  activeSlug: string;
  titles: Map<string, string>;
  title: string;
  /** Total commits in this page's history (0 ⇒ empty state). */
  commitCount: number;
  /** Zero-based index of the shown revision (0 = latest edit). */
  revIndex: number;
  /** Committer date of the shown revision (preformatted). */
  revDate?: string | null;
  /** Commit subject of the shown revision (ends in `via web` / `via mcp`). */
  revSubject?: string | null;
  /** Parsed word-diff for the shown revision; no `line` entries ⇒ no textual change. */
  lines: DiffLine[];
  username?: string | null;
}

export interface ArchiveView {
  siteTitle: string;
  spaces: SpaceInfo[];
  archiveTree: PageNode[];
  titles: Map<string, string>;
  username?: string | null;
}

export interface DashboardView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  /** The active space's own tree, so the sidebar reads as it does on any page in it. */
  tree: PageNode[];
  labelSet?: LabelDef[];
  titles: Map<string, string>;
  /** Display name of the space being reported on. */
  spaceTitle: string;
  /** Task notes in this space, already grouped per page. */
  groups: NotePageGroup[];
  summary: NoteSummary;
  /** Evaluated once per render so every age on the page is measured from one instant. */
  now: number;
  username?: string | null;
}

/** One report on the Dashboards hub: where it lives and the number that sums it up. */
export interface DashboardCard {
  href: string;
  title: string;
  description: string;
  value: string;
  valueLabel: string;
}

export interface DashboardsView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  titles: Map<string, string>;
  spaceTitle: string;
  cards: DashboardCard[];
  username?: string | null;
}

export interface GalleryView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  titles: Map<string, string>;
  spaceTitle: string;
  images: GalleryImage[];
  /** Paths (inside `_assets`) of the images just uploaded, marked in the grid. */
  added?: string[];
  notice?: ViewNotice;
  username?: string | null;
}

/** One page in the Labels view's result list. */
export interface LabelResult {
  slug: string;
  title: string;
  labels: string[];
  /** A search excerpt when a query is set, else the page's summary. */
  text?: string;
}

export interface LabelsDashboardView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  titles: Map<string, string>;
  spaceTitle: string;
  /** The space's palette, for colouring the labels each result carries. */
  labelSet: LabelDef[];
  /** Every label worth offering: palette first, then orphans, each with its page count. */
  known: KnownLabel[];
  /** Label names currently filtered on (a page must carry all of them). */
  selected: string[];
  /** The search box's text; empty lists every match in navigation order. */
  query: string;
  results: LabelResult[];
  notice?: ViewNotice;
  username?: string | null;
}

export interface DeleteView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  activeSlug: string;
  titles: Map<string, string>;
  title: string;
  fsPath: string;
  isSection: boolean;
  affectedCount: number;
  username?: string | null;
}

export interface SpacesView {
  siteTitle: string;
  spaces: SpaceInfo[];
  notice?: ViewNotice;
  username?: string | null;
  /** When set, show a delete-space confirmation for this space above the grid. */
  confirmDelete?: { key: string; title: string };
}

export interface LoginView {
  siteTitle: string;
  error?: string;
  next: string;
  username?: string;
}

export interface UpdateGateView {
  siteTitle: string;
  current: string;
  latest: string;
  notesUrl: string;
  logFile: string;
  /** The server's id (update.ts), which a restart on the old version changes. */
  instance: string;
  /** An update is already running, such as one the page's card started. */
  updating: boolean;
}

export interface ViewNotice {
  tone: "error" | "success" | "warning";
  text: string;
}

function slugPath(slug: string): string {
  if (!slug) return "/";
  return "/" + slug.split("/").map(encodeURIComponent).join("/");
}

function sidebarHtml(
  siteTitle: string,
  spaces: SpaceInfo[],
  spaceKey: string,
  tree: PageNode[],
  activeSlug: string,
  isArchiveView = false,
  labelSet: readonly LabelDef[] = []
): string {
  const archiveCls = isArchiveView ? " active" : "";

  // Outside any space (archive browser, 404): just list the spaces.
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
  <a class="brand" href="/">${escapeHtml(siteTitle)}</a>
  <a class="sidebar-link${archiveCls}" href="/_archive">Archive</a>
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
  const rootDropAttrs = isArchiveView
    ? ""
    : ` data-drop-slug="${escapeHtml(spaceKey)}" title="Drop a page here to move it to the space root"`;
  const switcher = `<div class="space-switcher">
    <a class="space-current" href="${slugPath(spaceKey)}"${rootDropAttrs}>${escapeHtml(spaceLabel)}</a>
    <a class="space-all" href="/">↩ All spaces</a>
  </div>`;
  // MOVE_SCRIPT still writes every drag failure into [data-move-error]; it used
  // to sit beside the removed drop strip, so it keeps its slot above the tree.
  const moveError = isArchiveView
    ? ""
    : `<div class="move-error" data-move-error hidden></div>`;

  // The labels a person can pick in this space — the palette, then orphans the
  // pages carry — shared by the search filter and the label dialog.
  const offered = knownLabels(labelSet, flatten(tree)).map(({ name, color, defined }) => ({
    name,
    color,
    defined,
  }));

  return `<aside class="sidebar">
  <a class="brand" href="/">${escapeHtml(siteTitle)}</a>
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
  <a class="sidebar-link${archiveCls}" href="/_archive">Archive</a>
  ${moveError}
  <nav class="tree">${renderTree(tree, activeSlug, {
    dragEnabled: !isArchiveView,
    collapsible: !isArchiveView,
    parentSlug: spaceKey,
  })}</nav>${isArchiveView ? "" : `\n  <script>${TREE_PLACE_SCRIPT}</script>`}
  ${SIDEBAR_PLACED_MARKER}
</aside>
<script>${SEARCH_SCRIPT}</script>
${isArchiveView ? "" : `${labelDialog(spaceKey, offered)}
${folderDialog()}`}`;
}

/**
 * The folder dialog, shared by every way of making or renaming a folder: the
 * sidebar's Create menu, a row's ⋯ menu and the folder page's own buttons.
 * FOLDER_DIALOG_SCRIPT switches it between creating (posts to /_create-folder
 * with the parent) and renaming (posts to /_rename-folder with the folder);
 * whichever hidden field the mode does not use is disabled, so it is not sent.
 */
function folderDialog(): string {
  return `<dialog class="folder-dialog" data-folder-dialog aria-labelledby="folder-dialog-title">
  <form class="label-dialog-form" method="post" action="/_create-folder" data-folder-form novalidate>
    <div class="help-head">
      <h2 id="folder-dialog-title" data-folder-heading>New folder</h2>
      <button type="button" class="help-close" data-folder-close aria-label="Close">&times;</button>
    </div>
    <div class="folder-dialog-body">
      <label class="folder-dialog-label" for="folder-dialog-name">Name</label>
      <input id="folder-dialog-name" class="folder-dialog-input" type="text" name="name" maxlength="120"
        autocomplete="off" spellcheck="false" required
        aria-describedby="folder-dialog-hint folder-dialog-error" data-folder-name />
      <p id="folder-dialog-hint" class="folder-dialog-hint" data-folder-hint hidden></p>
      <p id="folder-dialog-error" class="folder-dialog-error" role="alert" data-folder-error hidden></p>
      <input type="hidden" name="parentSlug" value="" data-folder-parent-field />
      <input type="hidden" name="slug" value="" data-folder-slug-field disabled />
    </div>
    <div class="label-dialog-actions">
      <button type="button" class="button secondary" data-folder-close>Cancel</button>
      <button type="submit" class="button primary" data-folder-submit>Create folder</button>
    </div>
  </form>
</dialog>
<script>${FOLDER_DIALOG_SCRIPT}</script>`;
}

/**
 * The palette as a row of colour radios, one checked. Radio groups are scoped
 * to their form, so several forms on one page can share the field name.
 */
function labelSwatches(name: string, checked: LabelColor, label = "Colour"): string {
  const radios = LABEL_COLORS.map(
    (color) => `<label class="label-swatch" title="${color}">
          <input type="radio" name="${name}" value="${color}"${color === checked ? " checked" : ""} />
          <span class="label-dot" data-label-color="${color}"></span>
          <span class="sr-only">${color}</span>
        </label>`
  ).join("");
  return `<div class="label-swatches" role="radiogroup" aria-label="${escapeHtml(label)}">${radios}</div>`;
}

/**
 * The one label dialog a sidebar shares across all its rows. Each row's
 * "Labels" item carries its page and current labels; LABELS_SCRIPT fills the
 * checkbox list from those and from the palette here, then the dialog posts a
 * plain form. Shipping the palette once beats a checkbox list in every row's
 * menu, which would repeat it for every page in the tree.
 */
function labelDialog(spaceKey: string, offered: readonly OfferedLabel[]): string {
  const swatches = labelSwatches("newColor", "gray");
  return `<dialog class="label-dialog" data-label-dialog aria-labelledby="label-dialog-title" data-label-palette="${escapeHtml(JSON.stringify(offered))}">
  <form class="label-dialog-form" method="post" action="/_labels/page">
    <div class="help-head">
      <h2 id="label-dialog-title">Labels</h2>
      <button type="button" class="help-close" data-label-close aria-label="Close">&times;</button>
    </div>
    <div class="label-dialog-body">
      <p class="label-dialog-page" data-label-page></p>
      <input type="hidden" name="slug" value="" data-label-slug />
      <input type="hidden" name="returnTo" value="" data-label-return />
      <fieldset class="label-dialog-list" data-label-list>
        <legend>In this space</legend>
      </fieldset>
      <p class="label-dialog-empty" data-label-none hidden>No labels in this space yet — create the first one below.</p>
      <fieldset class="label-dialog-new">
        <legend>New label</legend>
        <input type="text" name="newName" maxlength="40" placeholder="Name, e.g. Needs review" aria-label="New label name" autocomplete="off" />
        ${swatches}
      </fieldset>
    </div>
    <div class="label-dialog-actions">
      <a class="label-dialog-manage" href="${escapeHtml(labelsHref(spaceKey))}#manage-labels">Manage labels</a>
      <button type="button" class="button secondary" data-label-close>Cancel</button>
      <button type="submit" class="button primary">Save</button>
    </div>
  </form>
</dialog>
<script>${LABELS_SCRIPT}</script>`;
}

/** A label as the sidebar's scripts receive it: name, colour, and whether the palette defines it. */
type OfferedLabel = Pick<KnownLabel, "name" | "color" | "defined">;

/**
 * Sidebar search: an ARIA combobox scoped to the current space. The input owns
 * the combobox role; `SEARCH_SCRIPT` fills the listbox with `<a role="option">`
 * children and tracks the highlighted one through `aria-activedescendant`, so DOM
 * focus never leaves the field.
 *
 * `data-search-space` carries the scope and `data-search-labels` the labels
 * the filter offers, so the script needs no inline data. The filter button
 * stays hidden until the script reveals it, and only when there is a label to
 * pick. With JavaScript off this is an inert field; the Labels view is the
 * full, server-rendered search, and the panel's footer links there.
 */
function sidebarSearch(spaceKey: string, offered: readonly OfferedLabel[] = []): string {
  return `<div class="sidebar-search" data-search data-search-space="${escapeHtml(spaceKey)}" data-search-labels="${escapeHtml(JSON.stringify(offered))}">
    <div class="sidebar-search-field">
      <input id="kb-search-input" class="sidebar-search-input" type="search" data-search-input
        placeholder="Search this space" aria-label="Search this space"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        role="combobox" aria-expanded="false" aria-autocomplete="list"
        aria-haspopup="listbox" aria-controls="kb-search-results" />
      <button type="button" class="sidebar-search-filter" data-search-filter hidden
        aria-label="Filter by label" title="Filter by label" aria-expanded="false" aria-controls="kb-search-picker">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
        <span class="sidebar-search-filter-count" data-search-filter-count hidden></span>
      </button>
    </div>
    <div class="sidebar-search-chips" data-search-chips hidden></div>
    <div id="kb-search-picker" class="sidebar-search-picker" role="group" aria-label="Filter by label" data-search-picker hidden></div>
    <div class="sidebar-search-panel" data-search-panel hidden>
      <div id="kb-search-results" class="sidebar-search-list" role="listbox"
        aria-label="Search results" data-search-list></div>
      <div class="sidebar-search-status" data-search-status role="status" aria-live="polite" hidden></div>
      <a class="sidebar-search-more" data-search-more href="${escapeHtml(labelsHref(spaceKey))}" hidden>Show all results</a>
    </div>
  </div>`;
}

function sessionActions(username?: string | null): string {
  if (!username) return "";
  return `<form class="session-actions" method="post" action="/_logout">
    <span class="session-user">${escapeHtml(username)}</span>
    <button class="button secondary" type="submit">Log out</button>
  </form>`;
}

/**
 * Sun/moon button that flips the color theme. Which glyph shows is decided in
 * CSS from the root `data-theme`; the click is handled by the delegated listener
 * in `THEME_SCRIPT`, so this markup needs no per-page script of its own.
 */
function themeToggle(): string {
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle dark mode" title="Toggle dark mode">
    <svg class="theme-icon icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
    <svg class="theme-icon icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
  </button>`;
}

/** Where the current space's Dashboards hub lives. */
function dashboardsHref(spaceKey: string): string {
  return `/_dashboard?space=${encodeURIComponent(spaceKey)}`;
}

/**
 * Link to the current space's Dashboards hub. A plain anchor, so it needs no
 * handler of its own — and it only appears when a space is active, the same
 * rule the sidebar search follows: every dashboard reports on one space, and
 * the home page is not in one.
 */
function dashboardLink(spaceKey: string): string {
  if (!spaceKey) return "";
  return `<a class="dash-button" href="${dashboardsHref(spaceKey)}" aria-label="Dashboards" title="Dashboards">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
  </a>`;
}

/**
 * Link to the current space's standing instructions for the LLM. Same gate as
 * the dashboard: only meaningful inside a space.
 */
function instructionsLink(spaceKey: string): string {
  if (!spaceKey) return "";
  return `<a class="instructions-button" href="/_instructions?space=${encodeURIComponent(spaceKey)}" aria-label="Space instructions" title="Space instructions — standing orders for the LLM in this space">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h7" /></svg>
  </a>`;
}

/** Where the current space's image gallery lives. */
export function galleryHref(spaceKey: string): string {
  return `/_gallery?space=${encodeURIComponent(spaceKey)}`;
}

/**
 * Link to the current space's image gallery. Same gate as the dashboard: the
 * images live in one space's `_assets`, and the home page is not in one.
 */
function galleryLink(spaceKey: string): string {
  if (!spaceKey) return "";
  return `<a class="gallery-button" href="${galleryHref(spaceKey)}" aria-label="Gallery" title="Gallery — every image in this space">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>
  </a>`;
}

/**
 * Chat + dashboard + theme toggle + Help + username + Log out pinned to the
 * top-right corner, with the chat drawer the first of them opens. Every page
 * that draws it is past sign-in; with sign-in off there is no username, so the
 * corner keeps its tools and drops only the session part.
 */
/**
 * `follow`: the page reloads when the KB changes under it (CHANGES_SCRIPT). The
 * editor doesn't, since a reload would take the reader's unsaved edits with it.
 */
function sessionCorner(username?: string | null, spaceKey = "", chatSlug = "", follow = true): string {
  const cursor = follow ? changeCursor?.() : undefined;
  const changesCard =
    cursor === undefined
      ? ""
      : `<div class="update-card" data-changes data-cursor="${escapeHtml(cursor)}" data-space="${escapeHtml(spaceKey)}" data-slug="${escapeHtml(chatSlug)}" role="status" aria-live="polite" hidden></div>
<script>${CHANGES_SCRIPT}</script>`;
  return `<div class="session-corner">
    ${CHAT_BUTTON}
    ${galleryLink(spaceKey)}
    ${instructionsLink(spaceKey)}
    ${dashboardLink(spaceKey)}
    ${themeToggle()}
    ${FEEDBACK_BUTTON}
    <button type="button" class="button secondary" data-help-open>Help</button>
    ${sessionActions(username)}
    ${desktop ? QUIT_BUTTON : ""}
  </div>
<div class="update-card" data-update role="status" aria-live="polite" hidden></div>
${chatDrawer(chatSlug)}
<script>${CHAT_SCRIPT}</script>
${HELP_DIALOG}${desktop ? QUIT_DIALOG : ""}
<script>${HELP_SCRIPT}</script>
<script>${UPDATE_SCRIPT}</script>${changesCard ? `\n${changesCard}` : ""}
<script type="module">${FEEDBACK_SCRIPT}</script>`;
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
const SIDEBAR_RENDER_HOLD = `\n<link rel="expect" href="#${SIDEBAR_PLACED_ID}" blocking="render" />`;
const SIDEBAR_PLACED_MARKER = `<span id="${SIDEBAR_PLACED_ID}" hidden></span>`;

/**
 * The shared document <head>: theming meta, favicons, the inlined stylesheet, and
 * the FOUC-safe theme script. The script sets `data-theme` on <html> before the
 * body paints (from localStorage, else the OS preference) and wires the toggle.
 * `extra` is for head markup only some pages need, such as KaTeX's stylesheet
 * or SIDEBAR_RENDER_HOLD.
 */
function renderHead(title: string, extra = ""): string {
  return `<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
${FAVICON_TAGS}
<title>${title}</title>
<style>${STYLES}</style>${extra}
<script>${THEME_SCRIPT}</script>${desktop ? `\n<script>${QUIT_SCRIPT}</script>` : ""}
</head>`;
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
    v.canEdit === false || !v.activeSlug
      ? ""
      : `<a class="button secondary" href="/_download${slugPath(v.activeSlug)}" download>Download</a>`;
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
<script>${EDIT_SHORTCUT_SCRIPT}</script>
<script>${COPY_LINK_SCRIPT}</script>
${toc ? `<script>${TOC_SCRIPT}</script>` : ""}
${notesData ? `<script>${NOTES_SCRIPT}</script>` : ""}
${v.isArchiveView ? "" : `<script>${MOVE_SCRIPT}</script>`}
${v.contentHtml.includes('class="mermaid"') ? MERMAID_SCRIPT : ""}
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

export function archiveLayout(v: ArchiveView): string {
  const archiveHtml = v.archiveTree.length
    ? `<div class="archive-browser tree">${renderTree(v.archiveTree, "", {
        archiveMode: true,
      })}</div>`
    : "<p>No archived pages.</p>";

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: "",
    tree: [],
    activeSlug: "",
    titles: v.titles,
    title: "Archive",
    contentHtml: archiveHtml,
    canEdit: false,
    isArchiveView: true,
    username: v.username,
  });
}

/**
 * Where a page sits, as the titles of the sections above it.
 *
 * The space is dropped (every row on the dashboard is in the same one) and so is
 * the leaf, which is already the heading this sits beside. Titles rather than
 * slug segments, because a trail of `recommendation-removing-the-sharepoint-hop`
 * is longer than the note it is meant to place and reads as noise.
 */
function sectionTrail(slug: string, titles: Map<string, string>): string {
  const parts = slug.split("/");
  const trail: string[] = [];
  let acc = parts[0] ?? "";
  for (let i = 1; i < parts.length - 1; i += 1) {
    acc = `${acc}/${parts[i]}`;
    trail.push(titles.get(acc) ?? parts[i]);
  }
  return trail.join(" / ");
}

/** One statistic, big number over a label. */
function statCard(value: string, label: string): string {
  return `<div class="stat-card">
      <span class="stat-value">${escapeHtml(value)}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
    </div>`;
}

/**
 * A note's handle for pasting into a chat: the page it lives on and the note's
 * own id, e.g. `kb25/idea#7uribe42`.
 *
 * The bare id is what the reader sees on the row, but it is not what gets copied.
 * An agent handed `7uribe42` alone has to sweep every note in the KB to find it,
 * and a hand-written note's id is only `@<line>` — a number that means nothing
 * away from the page it was counted on. Prefixing the slug (the same string the
 * page's own "Copy link" copies) makes the reference resolvable by itself: the
 * page is named, and the id picks the note out of it.
 */
function noteRef(slug: string, id: string): string {
  return `${slug}#${id}`;
}

/**
 * One task note: the phrase it was left on, what it asks for, who asked when, and
 * its id.
 *
 * The row is a link pointing at the note's own anchor on its page rather than the
 * top of it — a page with fifteen notes is otherwise a scavenger hunt. The copy
 * button is a sibling of that link, not a child: a button nested inside an anchor
 * is invalid, and the two are separate destinations anyway.
 *
 * Every field here was written into a file by a person or an agent, so all of it
 * is escaped, exactly as the `#kb25-notes` payload treats the same strings.
 */
function noteRow(note: NotePageGroup["notes"][number], slug: string, now: number): string {
  const href = `${slugPath(slug)}#note-${encodeURIComponent(note.id)}`;
  const quote = note.quote
    ? `<span class="task-quote">${escapeHtml(note.quote)}</span>`
    : "";
  // A task with no words is legal (the parser defaults an unlabelled note to
  // task), and reads as a bare mark on the phrase — say so rather than showing a
  // blank row.
  const text = note.text
    ? `<span class="task-text">${escapeHtml(note.text)}</span>`
    : `<span class="task-text is-empty">No message — just marked.</span>`;
  const age = relativeAge(note.at, now);
  const byline = [note.by, age].filter(Boolean).join(" · ");
  const ref = escapeHtml(noteRef(slug, note.id));

  return `<li class="task-item">
      <a class="task-link" href="${href}">
        ${quote}
        ${text}
        ${byline ? `<span class="task-by">${escapeHtml(byline)}</span>` : ""}
      </a>
      <button type="button" class="task-copy" data-copy-slug="${ref}" data-copy-label="Note ID" title="Copy note ID — ${ref}" aria-label="Copy note ID ${ref}">
        ${COPY_GLYPH}
        <span class="task-id">${escapeHtml(note.id)}</span>
      </button>
    </li>`;
}

/**
 * The notes dashboard for one space: how much work is waiting, and every piece of
 * it as a link to where it was left.
 *
 * Only `task` notes appear. A remark is context and a highlight is a reader's
 * bookmark — neither asks for anything, so counting them here would blunt the one
 * question this page answers.
 */
export function dashboardLayout(v: DashboardView): string {
  const oldest = relativeAge(v.summary.oldestAt, v.now);
  const cards = [
    statCard(String(v.summary.total), v.summary.total === 1 ? "open task" : "open tasks"),
    statCard(String(v.summary.pages), v.summary.pages === 1 ? "page" : "pages"),
    statCard(oldest ? oldest.replace(/ ago$/, "") : "—", "oldest"),
  ].join("\n    ");

  const groups = v.groups
    .map((group) => {
      const trail = sectionTrail(group.slug, v.titles);
      // Its own line rather than a column in the heading row: a deep trail is
      // longer than the title it places, and squeezed beside one it would be
      // ellipsised down to "Ingestions / O…".
      const crumb = trail ? `<p class="task-crumb">${escapeHtml(trail)}</p>` : "";
      const count = group.notes.length;
      return `<section class="task-group">
      <h2 class="task-group-head">
        <a href="${slugPath(group.slug)}">${escapeHtml(group.title)}</a>
        <span class="task-count">${count}</span>
      </h2>
      ${crumb}
      <ul class="task-list">
        ${group.notes.map((note) => noteRow(note, group.slug, v.now)).join("\n        ")}
      </ul>
    </section>`;
    })
    .join("\n    ");

  const body = v.summary.total
    ? `<div class="stat-row">
    ${cards}
  </div>
  <div class="task-groups">
    ${groups}
  </div>`
    : `<div class="stat-row">
    ${cards}
  </div>
  <p class="dash-empty">No task notes in <strong>${escapeHtml(v.spaceTitle)}</strong>. Select a phrase on any page and leave one to queue up work here.</p>`;

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: "",
    titles: v.titles,
    title: `${v.spaceTitle} · Tasks`,
    contentHtml: `<div class="dash">
  ${dashboardsBackLink(v.spaceKey)}
  <p class="dash-lede">Task notes waiting in this space. Remarks and highlights are not counted.</p>
  ${body}
</div>`,
    canEdit: false,
    username: v.username,
  });
}

/** The way back from one dashboard to the hub that lists them all. */
function dashboardsBackLink(spaceKey: string): string {
  return `<a class="dash-back" href="${dashboardsHref(spaceKey)}">← Dashboards</a>`;
}

/**
 * The Dashboards hub for one space: every report on it, each a card with the
 * number that sums it up, so the hub answers "is anything waiting?" before a
 * report is even opened.
 */
export function dashboardsLayout(v: DashboardsView): string {
  const cards = v.cards
    .map(
      (card) => `<li>
      <a class="hub-card" href="${escapeHtml(card.href)}">
        <span class="hub-title">${escapeHtml(card.title)}</span>
        <span class="hub-stat"><span class="stat-value">${escapeHtml(card.value)}</span> <span class="stat-label">${escapeHtml(card.valueLabel)}</span></span>
        <span class="hub-desc">${escapeHtml(card.description)}</span>
      </a>
    </li>`
    )
    .join("\n    ");

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: "",
    titles: v.titles,
    title: `${v.spaceTitle} · Dashboards`,
    contentHtml: `<div class="dash">
  <p class="dash-lede">Reports on this space. Open one for the detail behind its number.</p>
  <ul class="hub-grid">
    ${cards}
  </ul>
</div>`,
    canEdit: false,
    username: v.username,
  });
}

/** A file size the way a person reads it: `830 KB`, `2.4 MB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The URL an image in a space's `_assets` is served at, each part encoded. */
function assetHref(spaceKey: string, rel: string): string {
  return `/${encodeURIComponent(spaceKey)}/_assets/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The gallery: every image in one space's `_assets`, used on a page or not,
 * and the form that uploads more. The caption under each is the reference a
 * page's Markdown uses, which for now is the only way onto a page.
 *
 * A thumbnail is a link to the image itself, so it opens with scripts off;
 * GALLERY_SCRIPT shows it in a dialog instead, which keeps a desktop window
 * on the gallery. The upload is a plain multipart form for the same reason.
 */
export function galleryLayout(v: GalleryView): string {
  const added = new Set(v.added ?? []);
  const count = v.images.length;
  const tiles = v.images
    .map((image) => {
      const href = escapeHtml(assetHref(v.spaceKey, image.path));
      const ref = escapeHtml(`_assets/${image.path}`);
      const name = escapeHtml(image.path.split("/").pop() ?? image.path);
      const size = escapeHtml(formatSize(image.size));
      return `<li class="gallery-item${added.has(image.path) ? " is-new" : ""}">
      <a class="gallery-thumb" href="${href}" data-gallery-open data-name="${name}" data-ref="${ref}" data-size="${size}" aria-label="View ${name}">
        <img src="${href}" alt="" loading="lazy" decoding="async" />
      </a>
      <code class="gallery-ref" title="${ref}">${ref}</code>
      <span class="gallery-size">${size}</span>
    </li>`;
    })
    .join("\n    ");

  const grid = count
    ? `<p class="gallery-count">${count} ${count === 1 ? "image" : "images"}</p>
  <ul class="gallery-grid">
    ${tiles}
  </ul>`
    : `<p class="dash-empty">No images in <strong>${escapeHtml(v.spaceTitle)}</strong> yet. Upload one to start.</p>`;

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: "",
    titles: v.titles,
    title: `${v.spaceTitle} · Gallery`,
    contentHtml: `<div class="gallery">
  <div class="gallery-bar">
    <p class="dash-lede">Every image in this space's <code>_assets</code> folder, whether a page shows it or not. To show one on a page, edit the page and add <code>![](_assets/name.png)</code> to its Markdown.</p>
    <form class="gallery-upload" method="post" action="${escapeHtml(galleryHref(v.spaceKey))}" enctype="multipart/form-data" data-gallery-upload>
      <label class="button primary">
        <input type="file" name="image" accept="${escapeHtml(IMAGE_ACCEPT)}" multiple required data-gallery-file />
        <span data-gallery-upload-label>Upload images</span>
      </label>
      <noscript><button class="button secondary" type="submit">Upload</button></noscript>
    </form>
  </div>
  ${grid}
</div>
<dialog class="gallery-viewer" data-gallery-viewer tabindex="-1">
  <form method="dialog" class="help-head">
    <h2 data-gallery-viewer-name></h2>
    <button class="help-close" aria-label="Close" value="close">&times;</button>
  </form>
  <div class="gallery-viewer-frame"><img data-gallery-viewer-img alt="" /></div>
  <p class="gallery-viewer-meta"><code data-gallery-viewer-ref></code> · <span data-gallery-viewer-size></span></p>
</dialog>
<script>${GALLERY_SCRIPT}</script>`,
    notice: v.notice,
    canEdit: false,
    username: v.username,
  });
}

/**
 * Choosing files sends them at once, with no second Upload click; and a
 * thumbnail opens in the dialog rather than leaving the page. A click with a
 * modifier key still opens the image the browser's way.
 */
const GALLERY_SCRIPT = `
(() => {
  const form = document.querySelector("[data-gallery-upload]");
  const input = form && form.querySelector("[data-gallery-file]");
  if (form && input) {
    input.addEventListener("change", () => {
      if (!input.files || !input.files.length) return;
      const label = form.querySelector("[data-gallery-upload-label]");
      if (label) label.textContent = "Uploading…";
      form.classList.add("is-busy");
      form.submit();
    });
  }

  const viewer = document.querySelector("[data-gallery-viewer]");
  if (!viewer || typeof viewer.showModal !== "function") return;
  const img = viewer.querySelector("[data-gallery-viewer-img]");
  const name = viewer.querySelector("[data-gallery-viewer-name]");
  const ref = viewer.querySelector("[data-gallery-viewer-ref]");
  const size = viewer.querySelector("[data-gallery-viewer-size]");
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-gallery-open]") : null;
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    img.src = link.href;
    name.textContent = link.dataset.name || "";
    ref.textContent = link.dataset.ref || "";
    size.textContent = link.dataset.size || "";
    viewer.showModal();
    // Not its close button, which would wear a focus ring until clicked away.
    viewer.focus();
  });
  // A click on the backdrop lands on the dialog itself.
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener("close", () => img.removeAttribute("src"));
})();
`;

/** Where the Labels view lives, filtered to the given labels and query. */
export function labelsHref(spaceKey: string, labels: readonly string[] = [], query = ""): string {
  const params = new URLSearchParams({ space: spaceKey });
  for (const label of labels) params.append("label", label);
  if (query) params.set("q", query);
  return `/_dashboard/labels?${params.toString()}`;
}

/**
 * One label as a pill. A label the palette does not define gets a dashed edge,
 * so it reads as "carried, but not set up" rather than as a deliberate grey.
 */
function labelChip(
  name: string,
  set: readonly LabelDef[],
  href?: string
): string {
  const key = labelKey(name);
  const defined = set.some((l) => labelKey(l.name) === key);
  const cls = defined ? "label-chip" : "label-chip is-orphan";
  const title = defined ? "" : ` title="Not in this space's label palette"`;
  const attrs = `class="${cls}" data-label-color="${colorOf(set, name)}"${title}`;
  return href
    ? `<a ${attrs} href="${escapeHtml(href)}">${escapeHtml(name)}</a>`
    : `<span ${attrs}>${escapeHtml(name)}</span>`;
}

/** A row of chips, each linking to the Labels view filtered to it alone. */
function labelChips(names: readonly string[], set: readonly LabelDef[], spaceKey: string): string {
  if (!names.length) return "";
  return `<span class="label-chips">${names
    .map((name) => labelChip(name, set, labelsHref(spaceKey, [name])))
    .join("")}</span>`;
}

/**
 * The Labels view: pages in one space filtered by label, optionally searched.
 *
 * It is one GET form, so every state — which labels, what query — is a URL a
 * person can bookmark or paste, and it works with scripts off. A page must
 * carry every ticked label; with none ticked it lists every labelled page.
 */
export function labelsDashboardLayout(v: LabelsDashboardView): string {
  const selectedKeys = new Set(v.selected.map(labelKey));
  const toggles = v.known
    .map((label) => {
      const checked = selectedKeys.has(labelKey(label.name));
      return `<label class="label-toggle">
        <input type="checkbox" name="label" value="${escapeHtml(label.name)}"${checked ? " checked" : ""} />
        ${labelChip(label.name, v.labelSet)}
        <span class="label-count">${label.count}</span>
      </label>`;
    })
    .join("\n      ");

  const filterForm = v.known.length
    ? `<form class="label-filter" method="get" action="/_dashboard/labels" data-label-filter>
    <input type="hidden" name="space" value="${escapeHtml(v.spaceKey)}" />
    <fieldset class="label-filter-chips">
      <legend class="label-filter-legend">Labels</legend>
      ${toggles}
    </fieldset>
    <div class="label-search">
      <input type="search" name="q" value="${escapeHtml(v.query)}" placeholder="Search pages in this space" aria-label="Search pages in this space" />
      <button class="button secondary" type="submit">Search</button>
      ${v.selected.length || v.query ? `<a class="label-clear" href="${escapeHtml(labelsHref(v.spaceKey))}">Clear</a>` : ""}
    </div>
  </form>`
    : `<p class="dash-empty">No labels in <strong>${escapeHtml(v.spaceTitle)}</strong> yet. Create one below, or open a page's ⋯ menu in the sidebar and choose “Labels”.</p>`;

  const items = v.results
    .map((r) => {
      const trail = sectionTrail(r.slug, v.titles);
      return `<li class="label-result">
        <a class="label-result-title" href="${slugPath(r.slug)}">${escapeHtml(r.title)}</a>
        ${trail ? `<p class="task-crumb">${escapeHtml(trail)}</p>` : ""}
        ${labelChips(r.labels, v.labelSet, v.spaceKey)}
        ${r.text ? `<p class="label-result-text">${escapeHtml(r.text)}</p>` : ""}
      </li>`;
    })
    .join("\n      ");

  const count = v.results.length;
  const results = !v.known.length
    ? ""
    : count
      ? `<p class="label-results-count">${count} ${count === 1 ? "page" : "pages"}</p>
  <ul class="label-results">
      ${items}
  </ul>`
      : `<p class="dash-empty">${
          v.query
            ? `No pages match “${escapeHtml(v.query)}”${v.selected.length ? " with these labels" : ""}.`
            : v.selected.length
              ? "No pages carry all of the selected labels."
              : "No pages carry a label yet."
        }</p>`;

  const notice = v.notice
    ? `<div class="notice ${v.notice.tone}">${escapeHtml(v.notice.text)}</div>`
    : "";

  const spaceField = `<input type="hidden" name="space" value="${escapeHtml(v.spaceKey)}" />`;
  const manageRows = v.known
    .map((label) => {
      const name = escapeHtml(label.name);
      const pages = `${label.count} ${label.count === 1 ? "page" : "pages"}`;
      return `<li class="label-manage-row">
        <form class="label-manage-form" method="post" action="/_labels/update">
          ${spaceField}
          <input type="hidden" name="name" value="${name}" />
          <input type="text" name="newName" value="${name}" maxlength="40" required aria-label="Name for ${name}" />
          ${labelSwatches("newColor", label.color, `Colour for ${label.name}`)}
          <button class="button secondary" type="submit">Save</button>
        </form>
        <details class="label-delete">
          <summary class="button danger">Delete</summary>
          <form method="post" action="/_labels/delete">
            ${spaceField}
            <input type="hidden" name="name" value="${name}" />
            <p>Removes “${name}” from the palette and from every page carrying it — ${pages} here, plus any archived ones.</p>
            <button class="button danger" type="submit">Delete label</button>
          </form>
        </details>
      </li>`;
    })
    .join("\n      ");
  const manage = `<section class="label-manage" id="manage-labels">
    <h2>Manage labels</h2>
    <p class="dash-lede">Renaming or deleting a label rewrites every page that carries it, in one commit.</p>
    <form class="label-manage-form label-create" method="post" action="/_labels/create">
      ${spaceField}
      <input type="text" name="name" maxlength="40" required placeholder="New label" aria-label="New label name" />
      ${labelSwatches("color", "gray", "Colour for the new label")}
      <button class="button primary" type="submit">Create</button>
    </form>
    ${v.known.length ? `<ul class="label-manage-list">
      ${manageRows}
    </ul>` : ""}
  </section>`;

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: "",
    titles: v.titles,
    title: `${v.spaceTitle} · Labels`,
    contentHtml: `<div class="dash labels-dash">
  ${dashboardsBackLink(v.spaceKey)}
  ${notice}
  <p class="dash-lede">Pages in this space by label. Tick labels to narrow the list — a page must carry all of them.</p>
  ${filterForm}
  ${results}
  ${manage}
</div>
<script>${LABEL_FILTER_SCRIPT}</script>`,
    canEdit: false,
    username: v.username,
  });
}

export function deleteLayout(v: DeleteView): string {
  const pagePath = slugPath(v.activeSlug);
  const affected =
    v.isSection && v.affectedCount > 1
      ? `<p>This section delete will remove ${v.affectedCount} Markdown pages from this subtree.</p>`
      : "";

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: v.activeSlug,
    titles: v.titles,
    title: `Delete ${v.title}`,
    contentHtml: `<div class="notice error"><strong>Permanent delete.</strong> This cannot be undone from the web UI.</div>
<p>Delete <strong>${escapeHtml(v.title)}</strong> at <code>${escapeHtml(pagePath)}</code>?</p>
${affected}
<form class="confirm-actions" method="post" action="/_delete${pagePath}">
  <button class="button danger" type="submit">Delete</button>
  <a class="button secondary" href="${pagePath}">Cancel</a>
</form>`,
    canEdit: false,
    username: v.username,
  });
}

export function editLayout(v: EditView): string {
  const error = v.error
    ? `<div class="notice error">${escapeHtml(v.error)}</div>`
    : "";
  const notice = v.notice
    ? `<div class="notice success">${escapeHtml(v.notice)}</div>`
    : "";
  const pagePath = slugPath(v.activeSlug);
  const segments = v.activeSlug.split("/");
  const leaf = segments[segments.length - 1] ?? "";
  const parentPrefix = segments.slice(0, -1).join("/");
  const slugField = v.instructions
    ? ""
    : v.activeSlug
    ? `<label class="editor-label" for="slug">URL slug</label>
    <div class="slug-row">
      <span class="slug-prefix">/${parentPrefix ? `${escapeHtml(parentPrefix)}/` : ""}</span>
      <input id="slug" name="slug" type="text" value="${escapeHtml(leaf)}" spellcheck="false" autocapitalize="off" />
    </div>
    <p class="slug-hint">Changes the page URL. Re-parent with drag-and-drop / Move instead.</p>`
    : "";

  const instructionsHint = v.instructions
    ? `<div class="instructions-hint">
      <p>Standing orders for the LLM working in <strong>${escapeHtml(v.instructions.spaceTitle)}</strong> — language, tone, formatting, and any context it should always have. They reach the LLM on its next knowledge-base call; no restart needed.</p>
      <p class="instructions-meta">This page is hidden from the sidebar and from search, and the LLM cannot edit it. Keep it under <span data-instructions-cap>${v.instructions.cap}</span> characters — it is re-sent on every call that touches this space, so put reference material on an ordinary page and link to it.</p>
      <p class="instructions-count" data-instructions-count aria-live="polite"></p>
    </div>`
    : "";

  return `<!doctype html>
<html lang="en">
${renderHead(`Edit ${escapeHtml(v.title)} · ${escapeHtml(v.siteTitle)}`, SIDEBAR_RENDER_HOLD)}
<body>
${sessionCorner(v.username, v.spaceKey, v.activeSlug, false)}
${sidebarHtml(v.siteTitle, v.spaces, v.spaceKey, v.tree, v.activeSlug, false, v.labelSet)}
<main class="content editor-content">
  ${breadcrumb(v.activeSlug, v.titles)}
  <header class="page-head">
    <div>
      <h1>Edit ${escapeHtml(v.title)}</h1>
      <div class="meta"><span class="path-label">${escapeHtml(pagePath)}</span></div>
    </div>
    <div class="actions">
      <a class="button secondary" href="${pagePath}">Cancel</a>
    </div>
  </header>
  ${error}${notice}
  ${instructionsHint}
  <form class="editor" method="post" action="/_edit${pagePath}">
    ${slugField}
    <label class="editor-label" for="markdown">Markdown</label>
    <textarea id="markdown" name="markdown" spellcheck="false">${escapeHtml(v.raw)}</textarea>
    <div class="form-actions">
      <button class="button primary" type="submit">Save</button>
      <a class="button secondary" href="${pagePath}">Cancel</a>
    </div>
  </form>
</main>
<script>${EDITOR_SCRIPT}</script>
${v.instructions ? `<script>${INSTRUCTIONS_COUNT_SCRIPT}</script>` : ""}
<script>${MOVE_SCRIPT}</script>
<script>${COPY_LINK_SCRIPT}</script>
</body>
</html>`;
}

/** A small pill labeling who made an edit, inferred from the commit-message suffix. */
function editSourceBadge(subject: string): string {
  const s = subject.toLowerCase();
  if (s.endsWith("via mcp") || s.endsWith("via chat")) return `<span class="badge badge-mcp">LLM</span>`;
  if (s.endsWith("via web")) return `<span class="badge badge-web">Person</span>`;
  return "";
}

/** Render parsed word-diff lines into the body of a <pre class="diffview">. */
function renderDiffBody(lines: DiffLine[]): string {
  const rows: string[] = [];
  let sawHunk = false;
  for (const line of lines) {
    if (line.type === "hunk") {
      // Suppress the leading header; mark only the gaps between later hunks.
      if (sawHunk) rows.push(`<span class="diff-sep">· · ·</span>`);
      sawHunk = true;
      continue;
    }
    rows.push(
      line.runs
        .map((r) => {
          const text = escapeHtml(r.text);
          if (r.kind === "add") return `<ins class="diff-add">${text}</ins>`;
          if (r.kind === "del") return `<del class="diff-del">${text}</del>`;
          return text;
        })
        .join("")
    );
  }
  return rows.join("\n");
}

export function diffLayout(v: DiffView): string {
  const pagePath = slugPath(v.activeSlug);
  const hasHistory = v.commitCount > 0;
  const hasChanges = v.lines.some((l) => l.type === "line");

  let panel: string;
  if (!hasHistory) {
    panel = `<div class="notice">No saved history yet for this page. Edits create history the moment they are committed.</div>`;
  } else {
    const base = `/_diff${pagePath}`;
    const olderIdx = v.revIndex + 1;
    const newerIdx = v.revIndex - 1;
    const olderBtn =
      olderIdx < v.commitCount
        ? `<a class="button secondary" href="${base}?rev=${olderIdx}">← Older</a>`
        : `<span class="button secondary disabled">← Older</span>`;
    const newerBtn =
      newerIdx >= 0
        ? `<a class="button secondary" href="${base}?rev=${newerIdx}">Newer →</a>`
        : `<span class="button secondary disabled">Newer →</span>`;
    const badge = v.revSubject ? editSourceBadge(v.revSubject) : "";
    const date = v.revDate ? `<span class="diff-date">${escapeHtml(v.revDate)}</span>` : "";
    const subject = v.revSubject
      ? `<span class="diff-subject">${escapeHtml(v.revSubject)}</span>`
      : "";
    const revbar = `<div class="revbar">
      <div class="revbar-meta">
        <span class="diff-pos">Edit ${v.revIndex + 1} of ${v.commitCount}</span>
        ${date}${subject}${badge}
      </div>
      <div class="revbar-nav">${newerBtn}${olderBtn}</div>
    </div>`;
    const body = hasChanges
      ? `<pre class="diffview">${renderDiffBody(v.lines)}</pre>`
      : `<div class="notice">No textual changes in this edit (it may have only touched frontmatter or whitespace).</div>`;
    panel = `${revbar}${body}`;
  }

  return `<!doctype html>
<html lang="en">
${renderHead(`History ${escapeHtml(v.title)} · ${escapeHtml(v.siteTitle)}`, SIDEBAR_RENDER_HOLD)}
<body>
${sessionCorner(v.username, v.spaceKey, v.activeSlug)}
${sidebarHtml(v.siteTitle, v.spaces, v.spaceKey, v.tree, v.activeSlug, false, v.labelSet)}
<main class="content">
  ${breadcrumb(v.activeSlug, v.titles)}
  <header class="page-head">
    <div>
      <h1>History <span class="diff-title">${escapeHtml(v.title)}</span></h1>
      <div class="meta"><span class="path-label">${escapeHtml(pagePath)}</span></div>
    </div>
    <div class="actions">
      <a class="button secondary" href="${pagePath}">Back to page</a>
      <a class="button secondary" href="/_edit${pagePath}">Edit</a>
    </div>
  </header>
  ${panel}
</main>
<script>${MOVE_SCRIPT}</script>
<script>${COPY_LINK_SCRIPT}</script>
</body>
</html>`;
}

export function loginLayout(v: LoginView): string {
  const error = v.error
    ? `<div class="notice error">${escapeHtml(v.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
${renderHead(`Sign in · ${escapeHtml(v.siteTitle)}`)}
<body class="login-page">
<div class="session-corner">${themeToggle()}</div>
<main class="login-panel">
  <h1>${escapeHtml(v.siteTitle)}</h1>
  <p class="login-subtitle">Sign in to continue.</p>
  ${error}
  <form class="login-form" method="post" action="/_login">
    <input type="hidden" name="next" value="${escapeHtml(v.next)}" />
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" value="${escapeHtml(
      v.username ?? ""
    )}" autofocus required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button class="button primary" type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}

/**
 * The update gate (feedback issue #21): what KB25's window opens on, in place
 * of the app, while a newer release is out. Installing it is the only way on;
 * an update that fails lets the person in on this version, until KB25 is
 * opened again. GATE_SCRIPT runs the update and follows it.
 */
export function updateGateLayout(v: UpdateGateView): string {
  const latest = escapeHtml(v.latest);
  return `<!doctype html>
<html lang="en">
${renderHead(`Update · ${escapeHtml(v.siteTitle)}`)}
<body class="gate-page">
<main class="gate-panel" data-gate data-current="${escapeHtml(v.current)}" data-latest="${latest}" data-log="${escapeHtml(v.logFile)}" data-instance="${escapeHtml(v.instance)}"${v.updating ? " data-updating" : ""}>
  <img class="gate-icon" src="/kb25.svg" alt="" width="48" height="48" />
  <h1 data-gate-title>Update Crescent to ${latest}</h1>
  <p class="gate-text" data-gate-text>A new version is out. Crescent installs every update before it opens, as updates can carry security fixes. It takes a minute or so, and your pages and settings are kept.</p>
  <a class="gate-notes" href="${escapeHtml(v.notesUrl)}" target="_blank" rel="noopener">What's new in ${latest}</a>
  <div class="gate-progress" data-gate-progress hidden></div>
  <div class="gate-actions" data-gate-actions>
    <button type="button" class="button primary" data-gate-install>Install update</button>
  </div>
</main>
<script>${GATE_SCRIPT}</script>
</body>
</html>`;
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

export function spacesLayout(v: SpacesView): string {
  const notice = v.notice
    ? `<div class="notice ${v.notice.tone}">${escapeHtml(v.notice.text)}</div>`
    : "";
  const confirm = v.confirmDelete
    ? `<div class="notice error space-confirm">
    <strong>Delete the “${escapeHtml(v.confirmDelete.title)}” space?</strong>
    This permanently removes the space, every page inside it, and its Git history. This cannot be undone.
    <form class="confirm-actions" method="post" action="/_delete-space${slugPath(v.confirmDelete.key)}">
      <button class="button danger" type="submit">Delete space</button>
      <a class="button secondary" href="/">Cancel</a>
    </form>
  </div>`
    : "";
  const cards = v.spaces.length
    ? v.spaces
        .map((s) => {
          const icon = s.icon
            ? `<span class="space-icon">${escapeHtml(s.icon)}</span>`
            : "";
          const summary = s.summary
            ? `<p class="space-summary">${escapeHtml(s.summary)}</p>`
            : "";
          // The card link cannot contain the interactive ⋯ menu (no nested
          // forms/anchors), so wrap both and float the menu into the corner.
          return `<div class="space-card-wrap">
    <a class="space-card" href="${slugPath(s.key)}">
      ${icon}
      <span class="space-card-title">${escapeHtml(s.title)}</span>
      ${summary}
    </a>
    ${spaceMenu(s)}
  </div>`;
        })
        .join("")
    : `<p class="empty">No spaces yet — create your first one below.</p>`;

  return `<!doctype html>
<html lang="en">
${renderHead(`Spaces · ${escapeHtml(v.siteTitle)}`)}
<body class="spaces-page">
${sessionCorner(v.username)}
<main class="spaces-main">
  <header class="spaces-head">
    <h1>${escapeHtml(v.siteTitle)}</h1>
  </header>
  ${notice}${confirm}
  <section class="spaces-grid">${cards}</section>
  <div class="spaces-foot">
    <form class="new-space-form" method="post" action="/_create-space">
      <input type="text" name="title" placeholder="New space name" aria-label="New space name" maxlength="80" required />
      <button class="button primary" type="submit">New Space</button>
    </form>
    <a class="button secondary" href="/_archive">Archive</a>
  </div>
</main>
<script>${SPACE_MENU_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Per-space ⋯ menu on the home grid: edit the space's display name (an inline
 * rename, the space's key/URL stays put), archive the whole space, or delete it
 * outright. Mirrors the sidebar page menu, but scoped to space-level actions.
 */
function spaceMenu(space: SpaceInfo): string {
  const key = space.key;
  return `<details class="space-menu">
    <summary aria-label="Space actions">⋯</summary>
    <div class="space-menu-pop">
      <form class="menu-name-form" method="post" action="/_rename-space">
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <input type="text" name="title" value="${escapeHtml(space.title)}" aria-label="Space name" required />
        <button type="submit">Rename</button>
      </form>
      <form method="post" action="/_archive-space">
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <button type="submit">Archive</button>
      </form>
      <a href="/_delete-space${slugPath(key)}">Delete</a>
    </div>
  </details>`;
}

/**
 * Site icon links, shared by every page head. The files live in app/public and
 * are served from the site root (see server.ts). The .ico covers legacy
 * browsers and the automatic /favicon.ico request; the SVG and sized PNGs cover
 * modern tabs, bookmarks, and iOS home-screen shortcuts.
 */
const FAVICON_TAGS = `<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/kb25.svg" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`;

/** Inline folder glyph prefixed to section rows in the sidebar tree. */
const FOLDER_ICON = `<svg class="tree-folder-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1.75 4c0-.69.56-1.25 1.25-1.25h2.94c.33 0 .65.13.88.37l.87.88c.05.04.11.07.18.07H13c.69 0 1.25.56 1.25 1.25v6.06c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z"/></svg>`;

/** Inline dot glyph prefixed to leaf-page rows (a content page with no children). */
const PAGE_DOT = `<svg class="tree-page-dot" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>`;

/** Two stacked sheets: the copy affordance on the dashboard's note-id buttons. */
const COPY_GLYPH = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>`;

/** Help dialog content: a short KB25 overview plus the keyboard shortcuts. */
const HELP_DIALOG = `<dialog class="help-dialog" data-help-dialog tabindex="-1">
  <form method="dialog" class="help-head">
    <h2>Crescent Help</h2>
    <button class="help-close" aria-label="Close help" value="close">&times;</button>
  </form>
  <section class="help-section">
    <h3>About Crescent</h3>
    <p>Crescent is a lean Markdown knowledge base. Content is organized into <strong>spaces</strong> &mdash; the top-level containers shown on the home page &mdash; and each space holds a tree of pages in the sidebar. Open any page and press <strong>Edit</strong> to change its Markdown; every save is committed to Git automatically. Drag pages in the sidebar to re-organize them: drop a page <em>onto</em> another one to nest it inside, or onto the line that appears <em>between</em> two pages to put it there &mdash; including the line at the top level, which lifts a child page back out to the space root. Use the <strong>&ctdot;</strong> menu next to a page to add a child, edit, download, label, copy its link, or delete it. <strong>Labels</strong> are coloured markers such as &ldquo;Draft&rdquo; or &ldquo;Needs review&rdquo;; they show as chips at the top of a page, and the <strong>Dashboards</strong> button in the corner lists and searches pages by label. The <strong>Gallery</strong> button beside the chat shows every image in the space and uploads new ones; to put one on a page, write <code>![](_assets/name.png)</code> in the page's Markdown. A glowing blue dot beside a page in the sidebar means it is new and has not been opened yet, whether an agent or a person added it; a ring on a closed group means such a page is inside. Opening the page clears it. <strong>Folders</strong> are pure containers &mdash; they hold pages and other folders but have no content of their own, so you rename them instead of editing them.</p>
  </section>
  <section class="help-section">
    <h3>Keyboard shortcuts</h3>
    <dl class="help-keys">
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd></dt>
      <dd>Search this space from the sidebar</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>E</kbd></dt>
      <dd>Edit the page you are viewing</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>S</kbd></dt>
      <dd>Save the page you are editing</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd></dt>
      <dd>Copy this page's relative link (space/&hellip;/page)</dd>
      <dt><kbd>Esc</kbd></dt>
      <dd>Close the search results or this dialog</dd>
    </dl>
  </section>
  <section class="help-section">
    <h3>Linking to a section</h3>
    <p>Every heading on a page is linkable. Hover one and click the <strong>#</strong> that appears after it to copy a reference to that section &mdash; <code>space/page#the-heading</code> &mdash; which you can paste into a page as <code>[[space/page#the-heading]]</code>. Long pages also get an <strong>On this page</strong> list on the right that follows you as you scroll. A heading's anchor comes from its text, so rewording it changes the link; to pin one that others rely on, write the anchor yourself as <code>## Heading {#my-anchor}</code>.</p>
  </section>
</dialog>`;

const HELP_SCRIPT = `
(() => {
  const dialog = document.querySelector("[data-help-dialog]");
  const openBtn = document.querySelector("[data-help-open]");
  if (!dialog || !openBtn) return;
  openBtn.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    // Not its close button, which would wear a focus ring until clicked away.
    dialog.focus();
  });
})();
`;

/** Power button, last in the corner of a launcher-started server; opens QUIT_DIALOG. */
const QUIT_BUTTON = `<button type="button" class="quit-button" data-quit-open aria-label="Quit Crescent" title="Quit Crescent — stop it until you open it again">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /><path d="M12 2v10" /></svg>
  </button>`;

/** Asks before quitting: Quit stops every open KB25 tab, not just this one. */
const QUIT_DIALOG = `<dialog class="help-dialog" data-quit-dialog tabindex="-1">
  <form method="dialog" class="help-head">
    <h2>Quit Crescent?</h2>
    <button class="help-close" aria-label="Cancel" value="cancel">&times;</button>
  </form>
  <section class="help-section">
    <p>Every open Crescent tab stops working until you open Crescent again.</p>
    <p class="quit-error" data-quit-error role="alert" hidden></p>
  </section>
  <form method="dialog" class="quit-actions">
    <button class="button secondary" value="cancel">Cancel</button>
    <button class="button primary" type="button" data-quit-confirm>Quit</button>
  </form>
</dialog>`;

/** Sparkles in the top-right corner that open and close the chat drawer. */
const CHAT_BUTTON = `<button type="button" class="chat-button" data-chat-open aria-expanded="false" aria-label="Chat" title="Chat — ask a question, or ask for a page">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" /><path d="M20 3v4M22 5h-4M4 17v2M5 18H3" /></svg>
  </button>`;

/**
 * The chat drawer, on every page with the corner. `slug` is the page being
 * viewed, sent with each message so "this page" means something to Claude.
 * The drawer starts hidden; CHAT_SCRIPT opens it before first paint when it
 * was open on the last page, so moving between pages does not make it jump.
 */
function chatDrawer(slug: string): string {
  return `<section class="chat-drawer" data-chat data-chat-slug="${escapeHtml(slug)}" aria-label="Chat" hidden>
  <div class="chat-head">
    <h2 class="chat-title" data-chat-title>New chat</h2>
    <span class="chat-engine" data-chat-engine hidden></span>
    <button type="button" class="chat-icon-button" data-chat-history-open aria-label="Earlier chats" title="Earlier chats">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    <button type="button" class="chat-icon-button" data-chat-new aria-label="New chat" title="New chat">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <button type="button" class="chat-icon-button" data-chat-close aria-label="Close chat" title="Close chat">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
  <div class="chat-history" data-chat-history hidden></div>
  <div class="chat-setup" data-chat-setup hidden></div>
  <div class="chat-log" data-chat-log></div>
  <div class="chat-activity" data-chat-activity role="status" hidden></div>
  <form class="chat-form" data-chat-form>
    <textarea class="chat-input" data-chat-input rows="1" aria-label="Message" placeholder="Ask anything, or ask for a page…"></textarea>
    <div class="chat-form-row chat-run" data-chat-run hidden>
      <select class="chat-select" data-chat-model aria-label="Model" title="The model the next message runs on"></select>
      <select class="chat-select" data-chat-effort aria-label="Effort" title="How much the model thinks before it answers"></select>
    </div>
    <div class="chat-form-row">
      <label class="chat-pages" title="Write the answer into the knowledge base as pages, not into the chat"><input type="checkbox" data-chat-pages /> Write to KB</label>
      <div class="chat-engines" data-chat-engines role="radiogroup" aria-label="Run this chat on" hidden></div>
      <button type="button" class="button secondary" data-chat-stop hidden>Stop</button>
      <button type="submit" class="button primary" data-chat-send>Send</button>
    </div>
  </form>
</section>`;
}

/**
 * The drawer's behaviour. A turn runs on the server (chat.ts), so this only
 * shows threads and follows a turn's event stream: a page that loads mid-turn
 * shows the thread so far, then attaches to the stream, which replays the turn
 * from its question. Server text goes in as text. A reply is the one piece of
 * HTML: the server rendered it from Markdown with raw HTML off, and it is
 * parsed with DOMParser, whose documents never run scripts, then moved in.
 */
const CHAT_SCRIPT = `
(() => {
  const drawer = document.querySelector("[data-chat]");
  const toggle = document.querySelector("[data-chat-open]");
  if (!drawer || !toggle) return;
  const $ = (sel) => drawer.querySelector(sel);
  const log = $("[data-chat-log]");
  const setup = $("[data-chat-setup]");
  const history = $("[data-chat-history]");
  const activity = $("[data-chat-activity]");
  const form = $("[data-chat-form]");
  const input = $("[data-chat-input]");
  const pages = $("[data-chat-pages]");
  const sendBtn = $("[data-chat-send]");
  const stopBtn = $("[data-chat-stop]");
  const titleEl = $("[data-chat-title]");
  const engineLabel = $("[data-chat-engine]");
  const enginePicker = $("[data-chat-engines]");
  const runRow = $("[data-chat-run]");
  const modelPicker = $("[data-chat-model]");
  const effortPicker = $("[data-chat-effort]");
  const slug = drawer.dataset.chatSlug || "";

  const saved = {
    get(key) {
      try { return localStorage.getItem("kb25.chat." + key); } catch { return null; }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem("kb25.chat." + key);
        else localStorage.setItem("kb25.chat." + key, value);
      } catch {}
    },
  };

  let threadId = saved.get("thread");
  let source = null;
  let streaming = null;
  let busy = false;
  let loaded = false;
  // Every engine and its state, from /_chat/status; and the open thread's
  // engine, or null while the chat is new and its engine can still be picked.
  let engines = [];
  let threadEngine = null;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // crypto.randomUUID needs a secure context, which a LAN host over plain
  // HTTP is not; the fallback builds the same shape from random bytes.
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  async function getJson(url) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  function setOpen(open) {
    document.body.classList.toggle("chat-open", open);
    drawer.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    saved.set("open", open ? "1" : null);
  }

  function setPages(on) {
    pages.checked = on;
    drawer.toggleAttribute("data-pages", on);
    input.placeholder = on ? "What should the pages cover?" : "Ask anything, or ask for a page…";
    saved.set("pages", on ? "1" : null);
  }

  function setBusy(on) {
    busy = on;
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
    if (on) return;
    setActivity("");
    // CHANGES_SCRIPT holds its reload while a turn runs.
    document.dispatchEvent(new Event("kb25:chat-idle"));
  }

  function setActivity(text) {
    activity.textContent = text;
    activity.hidden = !text;
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function showEmpty() {
    log.replaceChildren(el("p", "chat-empty", "Ask about anything, or ask for a page. Switch on Write to KB to have the answer written as pages instead."));
  }

  function showError(text) {
    log.querySelector(".chat-empty")?.remove();
    log.append(el("div", "chat-msg chat-error", text));
    scrollDown();
  }

  const ready = () => engines.filter((engine) => engine.status.state === "ok");
  const engineName = (id) => (engines.find((engine) => engine.id === id) || { name: id }).name;

  // A new chat's engine: the one picked last time while it is ready, else the first ready.
  function chosenEngine() {
    const list = ready();
    const last = saved.get("engine");
    return (list.find((engine) => engine.id === last) || list[0] || {}).id;
  }

  // The switch shows only for a new chat with two engines ready; a thread
  // keeps the engine it began with, which its label names instead.
  function renderEngines() {
    const list = ready();
    const both = list.length > 1;
    engineLabel.hidden = !(both && threadEngine);
    engineLabel.textContent = threadEngine ? engineName(threadEngine) : "";
    enginePicker.hidden = !(both && !threadEngine);
    if (!enginePicker.hidden) {
      const current = chosenEngine();
      enginePicker.replaceChildren(
        ...list.map((engine) => {
          const button = el("button", "", engine.name.split(" ")[0]);
          button.type = "button";
          button.setAttribute("role", "radio");
          button.setAttribute("aria-checked", String(engine.id === current));
          button.title = "Run this chat on " + engine.name;
          button.addEventListener("click", () => {
            saved.set("engine", engine.id);
            renderEngines();
          });
          return button;
        })
      );
    }
    renderRun();
  }

  const EFFORTS = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };

  // The model and effort the next message runs with, from what its engine
  // listed: each engine's last pick, else what it starts on (start). An
  // effort the model does not take gives way to the start's, then high, then
  // the model's lowest; a model that takes none shows no effort at all.
  function renderRun() {
    const engine = engines.find((e) => e.id === (threadEngine || chosenEngine())) || {};
    const models = engine.models;
    const option = (value, text) => {
      const node = el("option", "", text);
      node.value = value;
      return node;
    };
    if (models) {
      const model =
        models.find((m) => m.id === saved.get("model." + engine.id)) ||
        models.find((m) => m.id === engine.start.model) ||
        models[0];
      modelPicker.replaceChildren(...models.map((m) => option(m.id, m.name)));
      modelPicker.value = model.id;
      const efforts = model.efforts;
      effortPicker.replaceChildren(...efforts.map((e) => option(e, (EFFORTS[e] || e) + " effort")));
      const wanted = [saved.get("effort." + engine.id), engine.start.effort, "high"];
      effortPicker.value = wanted.find((e) => efforts.includes(e)) || efforts[0] || "";
      effortPicker.hidden = !efforts.length;
    } else {
      modelPicker.replaceChildren();
      effortPicker.replaceChildren();
    }
    runRow.hidden = !models;
  }

  const HELP = {
    claude: { url: "https://claude.com/claude-code", login: "claude", update: "claude update" },
    codex: { url: "https://github.com/openai/codex", login: "codex login", update: "codex update" },
  };

  // What one engine still needs before it can run.
  function engineHelp(engine) {
    const help = HELP[engine.id] || {};
    const status = engine.status;
    const code = (text) => el("code", "", text);
    const name = el("strong", "", engine.name);
    if (status.state === "missing") {
      const link = el("a", "", (help.url || "").replace("https://", ""));
      link.href = help.url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      return [name, " isn't installed. Install it from ", link, " and sign in."];
    }
    if (status.state === "signed-out") {
      return [name, " is installed but not signed in. Run ", code(help.login), " in a terminal and sign in."];
    }
    if (status.state === "too-old") {
      return [name, " " + status.version + " is too old for the chat, which needs " + status.minimum + " or newer. Run ", code(help.update), " in a terminal."];
    }
    if (status.state === "broken") {
      return [name, " at " + (status.path || "?") + " didn't answer as expected" + (status.detail ? ": " + status.detail : ".")];
    }
    return [name, " is ready."];
  }

  // Neither engine is ready: say what each needs.
  function showSetup() {
    const p = (...nodes) => { const para = el("p"); para.append(...nodes); return para; };
    const parts = [p("The chat runs on Claude Code or Codex, and neither is ready on this computer.")];
    for (const engine of engines) parts.push(p(...engineHelp(engine)));
    parts.push(p("Then press Retry."));
    const retry = el("button", "button secondary", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => start(true));
    parts.push(retry);
    setup.replaceChildren(...parts);
    setup.hidden = false;
    form.hidden = true;
    log.hidden = true;
  }

  const VERBS = {
    created: "Created", updated: "Updated", moved: "Moved", renamed: "Renamed",
    archived: "Archived", restored: "Restored", deleted: "Deleted", noted: "Left a note on",
  };

  // The server's account of what a turn wrote, every page linked.
  function reportCard(changes) {
    const card = el("div", "chat-msg chat-report");
    card.append(el("div", "chat-report-head", "Done"));
    const list = el("ul", "chat-report-list");
    for (const change of changes) {
      const item = el("li");
      const verb = VERBS[change.kind] || change.kind;
      item.append(el("span", "chat-report-verb", change.what === "page" ? verb + " " : verb + " " + change.what + " "));
      if (change.href) {
        const link = el("a", "", change.title);
        link.href = change.href;
        item.append(link);
      } else {
        item.append(el("span", "chat-report-gone", change.title));
      }
      item.append(el("span", "chat-report-slug", change.slug));
      list.append(item);
    }
    card.append(list);
    return card;
  }

  function renderMessage(message) {
    log.querySelector(".chat-empty")?.remove();
    if (message.role === "user") {
      const bubble = el("div", "chat-msg chat-user");
      if (message.forcePages) bubble.append(el("span", "chat-tag", "Write to KB"));
      bubble.append(el("div", "chat-user-text", message.text));
      log.append(bubble);
    } else if (message.role === "assistant") {
      const reply = el("div", "chat-msg chat-assistant prose");
      reply.append(...new DOMParser().parseFromString(message.html, "text/html").body.childNodes);
      log.append(reply);
    } else if (message.role === "report") {
      log.append(reportCard(message.changes));
    } else if (message.role === "error") {
      log.append(el("div", "chat-msg chat-error", message.text));
    }
  }

  function closeSource() {
    if (source) source.close();
    source = null;
    streaming = null;
  }

  // Follow the running turn. Its stream replays the turn from its question,
  // so whoever attaches mid-turn sees all of it.
  function attach() {
    closeSource();
    setBusy(true);
    setActivity("Thinking…");
    const es = new EventSource("/_chat/threads/" + threadId + "/events");
    source = es;
    let seen = false;
    let dropped = false;
    es.onerror = () => { dropped = true; };
    es.onmessage = (e) => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      const stick = nearBottom();
      if (event.type === "done") {
        es.close();
        if (source === es) source = null;
        streaming = null;
        setBusy(false);
        // Nothing seen, or the stream broke on the way (a restart): the
        // thread as stored is the only account of the turn.
        if (!seen || dropped) loadThread();
        return;
      }
      seen = true;
      if (event.type === "user") {
        renderMessage(event.message);
      } else if (event.type === "text") {
        if (!streaming) {
          streaming = el("div", "chat-msg chat-assistant chat-streaming");
          log.append(streaming);
        }
        streaming.textContent += event.text;
      } else if (event.type === "activity") {
        setActivity(event.text);
      } else if (event.type === "message") {
        if (event.message.role === "assistant" && streaming) {
          streaming.remove();
          streaming = null;
        }
        renderMessage(event.message);
      }
      if (stick) scrollDown();
    };
  }

  async function loadThread() {
    closeSource();
    history.hidden = true;
    const thread = threadId ? await getJson("/_chat/threads/" + threadId) : null;
    if (!thread) {
      threadId = null;
      threadEngine = null;
      saved.set("thread", null);
      titleEl.textContent = "New chat";
      renderEngines();
      showEmpty();
      setBusy(false);
      return;
    }
    titleEl.textContent = thread.title;
    threadEngine = thread.engine;
    renderEngines();
    log.replaceChildren();
    // A running turn's question is also the first thing its stream replays.
    (thread.running ? thread.messages.slice(0, -1) : thread.messages).forEach(renderMessage);
    if (!log.childElementCount) showEmpty();
    if (thread.running) attach();
    else setBusy(false);
    scrollDown();
  }

  async function start(fresh) {
    const status = await getJson("/_chat/status" + (fresh ? "?fresh=1" : ""));
    if (!status) {
      log.hidden = false;
      return showError("Crescent didn't answer. Is it still running?");
    }
    engines = status.engines || [];
    if (!ready().length) return showSetup();
    setup.hidden = true;
    form.hidden = false;
    log.hidden = false;
    renderEngines();
    if (!loaded) {
      loaded = true;
      await loadThread();
    }
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    if (!threadId) {
      threadId = newId();
      saved.set("thread", threadId);
    }
    const engine = threadEngine || chosenEngine();
    setBusy(true);
    setActivity("Thinking…");
    let res = null;
    try {
      res = await fetch("/_chat/threads/" + threadId + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A new chat says which engine to run on; a thread keeps its own.
        // Model and effort go with every message, unless left to the engine.
        body: JSON.stringify({
          text,
          forcePages: pages.checked,
          slug,
          engine: threadEngine ? undefined : engine,
          model: modelPicker.value || undefined,
          effort: effortPicker.value || undefined,
        }),
      });
    } catch {}
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setBusy(false);
      if (res && res.status === 503 && body.engine) {
        const problem = el("div", "chat-msg chat-error");
        problem.append(...engineHelp(body.engine), " Then send again.");
        log.querySelector(".chat-empty")?.remove();
        log.append(problem);
        return scrollDown();
      }
      return showError(res ? body.error || "That message couldn't be sent." : "Crescent didn't answer. Is it still running?");
    }
    input.value = "";
    autosize();
    if (body.title) titleEl.textContent = body.title;
    threadEngine = threadEngine || engine;
    renderEngines();
    attach();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", autosize);
  pages.addEventListener("change", () => setPages(pages.checked));
  modelPicker.addEventListener("change", () => {
    saved.set("model." + (threadEngine || chosenEngine()), modelPicker.value || null);
    renderRun();
  });
  effortPicker.addEventListener("change", () => {
    saved.set("effort." + (threadEngine || chosenEngine()), effortPicker.value || null);
  });

  stopBtn.addEventListener("click", () => {
    if (threadId) fetch("/_chat/threads/" + threadId + "/stop", { method: "POST" }).catch(() => {});
  });

  $("[data-chat-new]").addEventListener("click", () => {
    threadId = null;
    saved.set("thread", null);
    loadThread();
    input.focus();
  });

  async function showHistory() {
    const data = await getJson("/_chat/threads");
    const threads = data ? data.threads : [];
    const rows = threads.map((thread) => {
      const row = el("div", "chat-history-row");
      const open = el("button", "chat-history-open");
      open.type = "button";
      open.append(el("span", "chat-history-title", thread.title));
      const when = new Date(thread.updatedAt);
      const tags = (ready().length > 1 ? engineName(thread.engine) + " · " : "") + (thread.running ? "Answering · " : "");
      open.append(el("span", "chat-history-when", tags + when.toLocaleString()));
      open.addEventListener("click", () => {
        threadId = thread.id;
        saved.set("thread", threadId);
        loadThread();
      });
      row.append(open);
      if (!thread.running) {
        const del = el("button", "chat-icon-button", "×");
        del.type = "button";
        del.setAttribute("aria-label", "Delete " + thread.title);
        del.title = "Delete this chat";
        del.addEventListener("click", async () => {
          await fetch("/_chat/threads/" + thread.id + "/delete", { method: "POST" }).catch(() => {});
          if (thread.id === threadId) {
            threadId = null;
            saved.set("thread", null);
            await loadThread();
          }
          showHistory();
        });
        row.append(del);
      }
      return row;
    });
    history.replaceChildren(...(rows.length ? rows : [el("p", "chat-empty", "No earlier chats.")]));
    history.hidden = false;
  }

  $("[data-chat-history-open]").addEventListener("click", () => {
    if (history.hidden) showHistory();
    else history.hidden = true;
  });

  $("[data-chat-close]").addEventListener("click", () => {
    setOpen(false);
    toggle.focus();
  });

  drawer.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!history.hidden) history.hidden = true;
    else {
      setOpen(false);
      toggle.focus();
    }
  });

  toggle.addEventListener("click", () => {
    const open = drawer.hidden;
    setOpen(open);
    if (!open) return;
    start(true);
    input.focus();
  });

  setPages(saved.get("pages") === "1");
  // Before first paint, so a drawer that was open on the last page is simply there.
  if (saved.get("open") === "1") {
    setOpen(true);
    start(false);
  }
})();
`;

/** Speech bubble in the top-right corner that opens the feedback dialog. */
const FEEDBACK_BUTTON = `<button type="button" class="feedback-button" data-feedback-open aria-label="Send feedback" title="Send feedback — report a bug or suggest an idea to the Crescent developer">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  </button>`;

/**
 * The feedback dialog, from @elmir-mamedov/feedback (served at /_vendor/feedback
 * by server.ts). It draws itself in a shadow root in KB25's colours (see the
 * --feedback-* properties in STYLES) and opens from the corner's speech bubble.
 * GET /_feedback supplies what only the server knows, asked once per opening;
 * POST /_feedback takes the report (feedback.ts).
 */
const FEEDBACK_SCRIPT = `
import { reportForm } from "/_vendor/feedback/index.js";
import { mountFeedback } from "/_vendor/feedback/widget/index.js";

let pending = null;
const info = () => {
  pending ??= fetch("/_feedback", { headers: { accept: "application/json" }, cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .finally(() => setTimeout(() => { pending = null; }, 2000));
  return pending;
};

const root = document.documentElement;
const feedback = mountFeedback({
  app: "kb25",
  appName: "Crescent",
  button: false,
  version: () => info().then((i) => i && i.version),
  facts: () => info().then((i) => (i ? i.facts : {})),
  extras: [
    {
      // The end of kb25.log and update.log (feedback.ts): what helps most with a bug.
      label: "Diagnostic logs",
      recommended: true,
      load: () => info().then((i) => (i && i.logs ? { logs: i.logs } : null)),
    },
  ],
  // The address KB25 0.3.0 remembered, until the dialog has one of its own.
  email: () => {
    try { return localStorage.getItem("kb25.feedback.email"); } catch { return null; }
  },
  theme: () => {
    const theme = root.dataset.theme;
    if (theme === "light" || theme === "dark") return theme;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  },
  send: async (report) => {
    let res;
    try {
      res = await fetch("/_feedback", { method: "POST", headers: { accept: "application/json" }, body: reportForm(report) });
    } catch {
      return { status: "refused", error: "Crescent didn't answer. Is it still running?" };
    }
    const answer = await res.json().catch(() => null);
    if (answer && ["sent", "queued", "refused"].includes(answer.status)) return answer;
    return { status: "refused", error: "That didn't go through (" + res.status + "). Try again." };
  },
});
document.querySelectorAll("[data-feedback-open]").forEach((button) => {
  button.addEventListener("click", () => feedback.open());
});
`;

/**
 * The update card in the bottom-right corner. An installed copy answers
 * GET /_update (see update.ts); anywhere else that is a 404 page and the card
 * stays hidden. Update starts the installer, then polls until the server comes
 * back on the new version and reloads; the reloaded page says to restart
 * Claude clients, whose MCP servers keep running the old code until they
 * restart. Server text only ever goes in via textContent.
 */
const UPDATE_SCRIPT = `
(() => {
  const card = document.querySelector("[data-update]");
  if (!card || !window.fetch) return;
  const DISMISSED = "kb25.update.dismissed";
  const DONE = "kb25.update.done";
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, variant, onClick) => {
    const node = el("button", "button " + variant, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };
  const actions = (...buttons) => {
    const row = el("div", "update-actions");
    row.append(...buttons);
    return row;
  };
  const show = (...children) => { card.replaceChildren(...children); card.hidden = false; };
  const hide = () => { card.hidden = true; card.replaceChildren(); };

  async function getStatus() {
    const res = await fetch("/_update", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    return res.json();
  }

  function offer(s) {
    const notes = el("a", "update-notes", "What's new");
    notes.href = s.notesUrl;
    notes.target = "_blank";
    notes.rel = "noopener";
    show(
      el("p", "update-title", "Crescent " + s.latest + " is available"),
      notes,
      actions(
        button("Later", "secondary", () => { store.set(DISMISSED, s.latest); hide(); }),
        button("Update", "primary", () => update(s))
      )
    );
  }

  function failed(s, reason) {
    show(
      el("p", "update-title", "The update didn't finish"),
      el("p", "update-text", reason || "Details are in " + s.logFile + "."),
      actions(button("Close", "secondary", hide))
    );
  }

  async function update(s) {
    show(el("p", "update-title", "Updating Crescent…"), el("p", "update-text", "This page reloads when it's done."));
    let res = null;
    try { res = await fetch("/_update", { method: "POST" }); } catch {}
    if (!res || res.status !== 202) {
      const body = res ? await res.json().catch(() => ({})) : {};
      return failed(s, body.error);
    }
    const deadline = Date.now() + 5 * 60 * 1000;
    const poll = async () => {
      let now = null;
      try { now = await getStatus(); } catch {} // the server is restarting
      if (now && now.current === s.latest) {
        store.set(DONE, s.latest);
        location.reload();
      } else if ((now && now.state === "failed") || Date.now() > deadline) {
        failed(s);
      } else {
        setTimeout(poll, 1500);
      }
    };
    setTimeout(poll, 1500);
  }

  getStatus().then((s) => {
    if (!s) return;
    const done = store.get(DONE);
    if (done) {
      store.remove(DONE);
      if (done === s.current) {
        return show(
          el("p", "update-title", "Crescent is updated to " + done),
          el("p", "update-text", "If the Claude app or Claude Code is open, restart it to use the new version there."),
          actions(button("OK", "secondary", hide))
        );
      }
    }
    if (s.available && s.state !== "updating" && store.get(DISMISSED) !== s.latest) offer(s);
  }).catch(() => {});
})();
`;

/**
 * Runs the update gate's update (updateGateLayout) and opens the app once the
 * server is back on the new version. Shares the update card's storage keys, so
 * the first page says the update is done, and a person let in after a failed
 * update isn't offered the same one again straight away.
 */
const GATE_SCRIPT = `
(() => {
  const gate = document.querySelector("[data-gate]");
  if (!gate || !window.fetch) return;
  const { current, latest, log } = gate.dataset;
  const title = gate.querySelector("[data-gate-title]");
  const text = gate.querySelector("[data-gate-text]");
  const progress = gate.querySelector("[data-gate-progress]");
  const actions = gate.querySelector("[data-gate-actions]");
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  // Replace, so Back never comes here again.
  const enter = () => location.replace("/");
  const button = (label, variant, onClick) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "button " + variant;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  };
  function show(heading, body, busy, ...buttons) {
    title.textContent = heading;
    text.textContent = body;
    progress.hidden = !busy;
    actions.replaceChildren(...buttons);
    actions.hidden = !buttons.length;
  }
  const busy = () =>
    show("Updating Crescent to " + latest + "…", "Crescent opens by itself when it's done. Your pages and settings are kept.", true);

  async function getStatus() {
    const res = await fetch("/_update", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    return res.json();
  }

  function failed(reason) {
    show(
      "The update didn't install",
      (reason ? reason + " " : "") +
        "Check the internet connection and try again; details are in " + log + ". " +
        "Until then, Crescent " + current + " still works, and it asks again the next time it opens.",
      false,
      button("Try again", "secondary", install),
      button("Continue with " + current, "primary", () => {
        store("kb25.update.dismissed", latest);
        enter();
      })
    );
  }

  // Done once a server answers on another version. This server saying the
  // installer failed, or a new one still on this version (which a failed
  // installer starts again), means it didn't happen.
  function follow(instance) {
    busy();
    const deadline = Date.now() + 5 * 60 * 1000;
    const poll = async () => {
      let now = null;
      try { now = await getStatus(); } catch {} // the server is restarting
      if (now && now.current !== current) {
        store("kb25.update.done", now.current);
        enter();
      } else if ((now && (now.state === "failed" || now.instance !== instance)) || Date.now() > deadline) {
        failed();
      } else {
        setTimeout(poll, 1500);
      }
    };
    setTimeout(poll, 1500);
  }

  async function install() {
    busy();
    let res = null;
    try { res = await fetch("/_update", { method: "POST" }); } catch {}
    if (res && res.status === 202) {
      const started = await res.json().catch(() => null);
      return follow(started ? started.instance : gate.dataset.instance);
    }
    // Refused: an update already running is followed, and with nothing left
    // to install, the app opens.
    let now = null;
    try { now = await getStatus(); } catch {}
    if (now && now.state === "updating") return follow(now.instance);
    if (now && !now.available) return enter();
    const body = res ? await res.json().catch(() => ({})) : {};
    failed(body.error);
  }

  gate.querySelector("[data-gate-install]").addEventListener("click", install);
  if ("updating" in gate.dataset) follow(gate.dataset.instance);
})();
`;

/**
 * Follows the KB's change feed (changes.ts) from the cursor the page was
 * rendered with, so a page an agent wrote shows up without a click (feedback
 * issue #17). A change to the open page, or to any page in the sidebar's space,
 * reloads the page, unless that would take something from the reader: then the
 * card offers the reload instead. A turn in this window's chat, a press, or the
 * update card holds it until they end, so a turn that writes three pages costs
 * one reload, when it is done.
 *
 * A hidden page lets its stream go, since a browser keeps only six open to a
 * server and every page holds one, and asks for what it missed when shown again.
 */
const CHANGES_SCRIPT = `
(() => {
  const card = document.querySelector("[data-changes]");
  if (!card || !window.EventSource) return;
  const space = card.dataset.space || "";
  const slug = card.dataset.slug || "";
  let cursor = card.dataset.cursor || "";
  let source = null;
  let pressed = false;
  // "page" once the open page has changed, "space" while only others have.
  let pending = null;

  // Null slugs are a change the feed couldn't name, so it may be this page.
  function affects(slugs) {
    if (!slugs || (slug && slugs.includes(slug))) return "page";
    return slugs.some((s) => !space || s === space || s.startsWith(space + "/")) ? "space" : null;
  }

  function held() {
    const stop = document.querySelector("[data-chat-stop]");
    const update = document.querySelector("[data-update]");
    return pressed || (stop && !stop.hidden) || (update && !update.hidden);
  }

  // Text not yet sent or saved, an open dialog, or a selection on its way to
  // becoming a note. A field that isn't shown, in a closed dialog, keeps
  // whatever it last held and counts for nothing.
  function busy() {
    if (document.querySelector("dialog[open]")) return true;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return true;
    const fields = document.querySelectorAll("textarea, input:not([type]), input[type=text], input[type=search]");
    for (const field of fields) {
      if (field.value !== field.defaultValue && field.getClientRects().length) return true;
    }
    return false;
  }

  const button = (label, variant, onClick) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "button " + variant;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  };

  function offer() {
    const title = document.createElement("p");
    title.className = "update-title";
    title.textContent = pending === "page" ? "This page has changed" : "Pages here have changed";
    const text = document.createElement("p");
    text.className = "update-text";
    text.textContent = "Reload to see the latest version.";
    const actions = document.createElement("div");
    actions.className = "update-actions";
    actions.append(
      button("Later", "secondary", () => { pending = null; card.hidden = true; card.replaceChildren(); }),
      button("Reload", "primary", () => location.reload())
    );
    card.replaceChildren(title, text, actions);
    card.hidden = false;
  }

  // Once offered, the reload is the reader's to make; a later change only
  // updates what the card says.
  function apply() {
    if (!pending || held()) return;
    if (!card.hidden || busy()) return offer();
    location.reload();
  }

  function connect() {
    if (source || document.hidden) return;
    source = new EventSource("/_changes?since=" + encodeURIComponent(cursor));
    source.onmessage = (event) => {
      if (event.lastEventId) cursor = event.lastEventId;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      const change = affects(data.slugs);
      if (!change) return;
      pending = pending === "page" ? "page" : change;
      apply();
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return connect();
    if (source) source.close();
    source = null;
  });
  document.addEventListener("pointerdown", () => { pressed = true; }, true);
  const released = () => { pressed = false; setTimeout(apply, 0); };
  document.addEventListener("pointerup", released, true);
  document.addEventListener("pointercancel", released, true);
  document.addEventListener("click", () => setTimeout(apply, 0));
  document.addEventListener("kb25:chat-idle", apply);
  connect();
})();
`;

/**
 * The Quit button of a launcher-started server (KB25_DESKTOP), for a page in an
 * ordinary browser tab; KB25's own window quits by being closed, and hides it.
 * The tab that quits tells the others over a BroadcastChannel, so each shows
 * that KB25 has quit instead of failing on its next click. Runs in <head> on
 * every page, the sign-in page included, to hear that.
 */
const QUIT_SCRIPT = `
(() => {
  const channel = window.BroadcastChannel ? new BroadcastChannel("kb25") : null;
  let quit = false;

  // The page stays as it is, so an editor still shows what was typed.
  function showQuit() {
    if (quit) return;
    quit = true;
    const el = (className, text) => {
      const node = document.createElement("p");
      node.className = className;
      node.textContent = text;
      return node;
    };
    const card = document.querySelector("[data-update]") || document.body.appendChild(document.createElement("div"));
    card.className = "update-card";
    card.setAttribute("role", "status");
    card.replaceChildren(el("update-title", "Crescent has quit"), el("update-text", "Open Crescent again to keep using it."));
    card.hidden = false;
  }

  if (channel) channel.addEventListener("message", (event) => { if (event.data === "quit") showQuit(); });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const dialog = document.querySelector("[data-quit-dialog]");
    if (!dialog) return;
    const error = dialog.querySelector("[data-quit-error]");
    if (target.closest("[data-quit-open]")) {
      error.hidden = true;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      dialog.focus();
      return;
    }
    const confirm = target.closest("[data-quit-confirm]");
    if (!confirm) return;
    confirm.disabled = true;
    fetch("/_quit", { method: "POST" })
      .then((res) => {
        if (res.status !== 202) throw new Error("HTTP " + res.status);
        dialog.close();
        if (channel) channel.postMessage("quit");
        showQuit();
      })
      .catch(() => {
        error.textContent = "Crescent didn't quit. Try again.";
        error.hidden = false;
        confirm.disabled = false;
      });
  });
})();
`;

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
const COPY_LINK_SCRIPT = `
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
    // slack the entry above it wins the section the reader just clicked.
    const line = 28 + 1;
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
 * Applies the color theme and keeps it in sync. Runs in <head> before first
 * paint so there is no flash of the wrong theme: it reads the saved preference
 * (`kb:theme`), falling back to dark, KB25's default whatever the OS uses, and
 * sets `data-theme` on <html>. A single delegated click handler flips + persists the
 * theme for any `[data-theme-toggle]` button on the page, and re-renders Mermaid
 * diagrams (if present) so they re-color live.
 */
const THEME_SCRIPT = `
(() => {
  const KEY = "kb:theme";
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const effective = () => {
    const s = read();
    return s === "light" || s === "dark" ? s : "dark";
  };
  const apply = (theme) => {
    root.dataset.theme = theme;
    if (typeof window.__renderMermaid === "function") window.__renderMermaid();
  };
  apply(effective());
  document.addEventListener("click", (event) => {
    const target = event.target;
    const btn = target && target.closest ? target.closest("[data-theme-toggle]") : null;
    if (!btn) return;
    event.preventDefault();
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  });
})();
`;

/**
 * Loads Mermaid from the app's own bundle and renders every `<pre class="mermaid">`
 * container into an SVG diagram. Injected only on pages that contain one (see
 * `layout`). `securityLevel: "strict"` keeps Mermaid's DOMPurify sanitizer on,
 * matching the viewer's no-raw-HTML posture. The `<script>` sits at the end of
 * <body>, so all diagram containers are already in the DOM when it runs.
 *
 * The diagram theme follows the page theme. Because Mermaid bakes colors into the
 * generated SVG, we stash each container's source and expose `window.__renderMermaid`,
 * which re-initializes with the current theme and re-renders — `THEME_SCRIPT` calls
 * it on every toggle so on-screen diagrams re-color live.
 */
const MERMAID_SCRIPT = `<script src="/_vendor/mermaid/mermaid.min.js"></script>
<script>
  (() => {
    const nodes = Array.from(document.querySelectorAll("pre.mermaid"));
    nodes.forEach((n) => { if (n.dataset.src === undefined) n.dataset.src = n.textContent; });
    window.__renderMermaid = () => {
      if (typeof mermaid === "undefined") return;
      const dark = document.documentElement.dataset.theme === "dark";
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      nodes.forEach((n) => { n.textContent = n.dataset.src; n.removeAttribute("data-processed"); });
      mermaid.run({ nodes });
    };
    window.__renderMermaid();
  })();
</script>`;

/**
 * KaTeX's stylesheet, from the app's own copy (see `/_vendor/katex` in server.ts).
 * The formulas are already typeset into the page's HTML by markdown.ts; this and
 * the fonts it names are all a page needs to draw them.
 */
const KATEX_CSS = `<link rel="stylesheet" href="/_vendor/katex/katex.min.css" />`;

/** Cmd/Ctrl+S submits the open editor form instead of the browser save dialog. */
const EDITOR_SCRIPT = `
(() => {
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
    const form = document.querySelector("form.editor");
    if (!form) return;
    event.preventDefault();
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  });
})();
`;

/**
 * Live character count for the space-instructions editor.
 *
 * Counts the body only — the frontmatter is plumbing, and it is the body that is
 * delivered to the LLM and measured against the cap. Warns rather than blocks:
 * a hard stop mid-thought is worse than a clear number.
 */
const INSTRUCTIONS_COUNT_SCRIPT = `
(() => {
  const area = document.getElementById("markdown");
  const out = document.querySelector("[data-instructions-count]");
  const capEl = document.querySelector("[data-instructions-cap]");
  if (!area || !out || !capEl) return;
  const cap = parseInt(capEl.textContent, 10) || 2000;

  // Every escape below is doubled because this is a template literal: a
  // single-backslash escape collapses into a real newline on emit and breaks
  // both the regex and the surrounding script. Same trap as NOTES_SCRIPT.
  const bodyOf = (raw) => {
    const match = /^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/.exec(raw);
    return (match ? raw.slice(match[0].length) : raw).trim();
  };

  const render = () => {
    const chars = bodyOf(area.value).length;
    const over = chars > cap;
    out.textContent = over
      ? chars + " characters — " + (chars - cap) + " over the " + cap + " limit. The extra will be cut when it reaches the LLM."
      : chars + " of " + cap + " characters.";
    out.classList.toggle("over", over);
  };

  area.addEventListener("input", render);
  render();
})();
`;

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
const TREE_PLACE_SCRIPT = `
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

const MOVE_SCRIPT = `
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

  // Multi-selection: shift-click selects an inclusive range from the anchor;
  // Ctrl/Cmd-click toggles a single item. State is in-memory only — it just
  // needs to survive from the click until the drag, and navigation reloads.
  const selected = new Set();
  let anchorIndex = orderedLinks.findIndex((el) => el.classList.contains("active"));
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
      if (event.shiftKey) {
        event.preventDefault();
        if (anchorIndex < 0) anchorIndex = index;
        selectRange(anchorIndex, index);
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      } else if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        const slug = slugOf(link);
        if (selected.has(slug)) selected.delete(slug);
        else selected.add(slug);
        anchorIndex = index;
        applySelection();
      } else {
        // Plain click navigates; drop any lingering selection first.
        selected.clear();
        applySelection();
      }
    });

    link.addEventListener("dragstart", (event) => {
      const slug = slugOf(link);
      // Grabbing a selected item drags the whole selection; else just this one.
      let slugs = selected.has(slug) && selected.size > 0 ? Array.from(selected) : [slug];
      // Drop descendants of another dragged slug — the ancestor carries them.
      slugs = slugs.filter((s) => !slugs.some((o) => o !== s && s.startsWith(o + "/")));
      // Sidebar order, so a multi-page drop lands in the order it was shown in
      // rather than the order the pages happened to be ctrl-clicked.
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

/**
 * Sidebar search. A debounced GET to /_search fills an ARIA listbox under the
 * input; ↑/↓ move the highlighted option (via aria-activedescendant, so focus
 * stays in the field), Enter opens it, Esc dismisses and then clears.
 * Cmd/Ctrl+K focuses the box from anywhere on the page.
 *
 * The endpoint sends plain text plus the query's tokens — never HTML — and every
 * string reaches the DOM through textContent, so page content cannot inject
 * markup into the dropdown.
 */
const SEARCH_SCRIPT = `
(() => {
  const root = document.querySelector("[data-search]");
  if (!root) return;
  const input = root.querySelector("[data-search-input]");
  const panel = root.querySelector("[data-search-panel]");
  const list = root.querySelector("[data-search-list]");
  const status = root.querySelector("[data-search-status]");
  if (!input || !panel || !list || !status) return;
  const filterButton = root.querySelector("[data-search-filter]");
  const filterCount = root.querySelector("[data-search-filter-count]");
  const picker = root.querySelector("[data-search-picker]");
  const chips = root.querySelector("[data-search-chips]");
  const more = root.querySelector("[data-search-more]");

  const space = root.getAttribute("data-search-space") || "";
  let offered = [];
  try {
    offered = JSON.parse(root.getAttribute("data-search-labels") || "[]");
  } catch (error) {
    offered = [];
  }
  const hasFilter = !!(filterButton && filterCount && picker && chips) && offered.length > 0;
  // Label names every result must carry, in the order they were picked. Kept
  // per space for the tab's lifetime, so opening a result keeps the filter on.
  const STORE_KEY = "kb:search-labels:" + space;
  let selected = [];
  const DEBOUNCE_MS = 180;
  const MIN_LENGTH = 2;
  const LIMIT = 8;

  let timer = 0;
  let controller = null;
  let items = [];
  let activeIndex = -1;
  // What the newest request asked for — the query and the labels — so a slower
  // answer to an older question is dropped rather than drawn.
  let lastKey = "";
  // Backspacing to a query already asked about is the most common wasted round
  // trip; a plain Map kills it. Cleared wholesale rather than evicted by age —
  // it only has to survive until the next navigation.
  const cache = new Map();

  function labelKey(name) {
    return String(name).trim().normalize("NFC").toLowerCase();
  }

  function colorOf(name) {
    const key = labelKey(name);
    const found = offered.find((entry) => labelKey(entry.name) === key);
    return found ? found.color : "gray";
  }

  function requestKey(query) {
    return JSON.stringify([query, selected]);
  }

  function labelsUrl(query) {
    const params = new URLSearchParams({ space: space });
    selected.forEach((name) => params.append("label", name));
    if (query) params.set("q", query);
    return "/_dashboard/labels?" + params.toString();
  }

  function showMore(query) {
    if (!more) return;
    more.href = labelsUrl(query);
    more.hidden = false;
  }

  function setStatus(text) {
    status.textContent = text || "";
    status.hidden = !text;
  }

  function open() {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function clearList() {
    list.textContent = "";
    items = [];
    activeIndex = -1;
  }

  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    clearList();
    setStatus("");
    if (more) more.hidden = true;
  }

  function setActive(index) {
    const previous = items[activeIndex];
    if (previous) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-selected", "false");
    }
    activeIndex = index;
    const el = items[index];
    if (!el) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    el.classList.add("is-active");
    el.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", el.id);
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }

  // Wrap each occurrence of a query token in <mark>, longest-token-first at any
  // given position so "dep" inside "deploy" cannot produce a nested mark. Every
  // slice goes in as a text node, so nothing here can introduce markup.
  function highlight(target, text, tokens) {
    target.textContent = "";
    const lower = text.toLowerCase();
    // A handful of code points change length when lowercased (e.g. "İ"), which
    // would desync every offset below. Fall back to plain text instead.
    const usable = lower.length === text.length && tokens.length > 0;
    let cursor = 0;
    while (usable && cursor < text.length) {
      let at = -1;
      let length = 0;
      for (const token of tokens) {
        if (!token) continue;
        const found = lower.indexOf(token, cursor);
        if (found === -1) continue;
        if (at === -1 || found < at || (found === at && token.length > length)) {
          at = found;
          length = token.length;
        }
      }
      if (at === -1) break;
      if (at > cursor) target.appendChild(document.createTextNode(text.slice(cursor, at)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(at, at + length);
      target.appendChild(mark);
      cursor = at + length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function render(payload, query) {
    clearList();
    const results = payload.results || [];
    const tokens = payload.tokens || [];
    showMore(query);
    if (!results.length) {
      const where = selected.length ? " with these labels" : " in this space";
      setStatus(query ? "No matches for \\"" + query + "\\"" + where + "." : "No pages carry these labels.");
      open();
      return;
    }
    setStatus("");
    results.forEach((result, index) => {
      const item = document.createElement("a");
      item.className = "sidebar-search-item";
      item.id = "kb-search-opt-" + index;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.href = result.url;

      const title = document.createElement("span");
      title.className = "sidebar-search-title";
      highlight(title, String(result.title || ""), tokens);
      const labels = Array.isArray(result.labels) ? result.labels : [];
      if (labels.length) {
        const dots = document.createElement("span");
        dots.className = "sidebar-search-dots";
        dots.title = labels.join(", ");
        labels.slice(0, 3).forEach((name) => {
          const dot = document.createElement("span");
          dot.className = "label-dot";
          dot.setAttribute("data-label-color", colorOf(name));
          dots.appendChild(dot);
        });
        title.appendChild(dots);
      }
      item.appendChild(title);

      if (result.crumb) {
        const crumb = document.createElement("span");
        crumb.className = "sidebar-search-crumb";
        crumb.textContent = result.crumb;
        item.appendChild(crumb);
      }

      const excerpt = String(result.excerpt || "");
      if (excerpt) {
        const body = document.createElement("span");
        body.className = "sidebar-search-excerpt";
        highlight(body, excerpt, tokens);
        item.appendChild(body);
      }

      item.addEventListener("mousemove", () => setActive(index));
      list.appendChild(item);
      items.push(item);
    });
    open();
    setActive(0);
  }

  async function run(query) {
    if (controller) controller.abort();
    const key = requestKey(query);
    const cached = cache.get(key);
    if (cached) {
      render(cached, query);
      return;
    }

    controller = new AbortController();
    setStatus("Searching…");
    open();
    const url = "/_search?q=" + encodeURIComponent(query) +
      "&space=" + encodeURIComponent(space) + "&limit=" + LIMIT +
      selected.map((name) => "&label=" + encodeURIComponent(name)).join("");
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      // An expired session 303s to the sign-in page, which fetch follows — so a
      // stale tab would get HTML with response.ok true. Reload so the user lands
      // on the login form instead of an empty dropdown.
      if (response.redirected) {
        window.location.reload();
        return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) {
        clearList();
        setStatus(result && result.error ? result.error : "Search failed.");
        return;
      }
      // abort() does not reliably beat a response already in flight, so stale
      // answers are dropped by what they asked for as well.
      if (key !== lastKey) return;
      if (cache.size > 50) cache.clear();
      cache.set(key, result);
      render(result, query);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      clearList();
      setStatus("Search failed.");
    }
  }

  // A query too short to search still counts as none; with labels picked, no
  // query lists the pages carrying them.
  function refresh() {
    const typed = input.value.trim();
    const query = typed.length >= MIN_LENGTH ? typed : "";
    lastKey = requestKey(query);
    window.clearTimeout(timer);
    if (!query && !selected.length) {
      if (controller) controller.abort();
      close();
      return;
    }
    timer = window.setTimeout(() => run(query), DEBOUNCE_MS);
  }

  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => {
    if (selected.length && panel.hidden) refresh();
  });

  function togglePicker(show) {
    if (!hasFilter) return;
    picker.hidden = !show;
    filterButton.setAttribute("aria-expanded", show ? "true" : "false");
  }

  function renderChips() {
    chips.textContent = "";
    selected.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "label-chip sidebar-search-chip";
      chip.setAttribute("data-label-color", colorOf(name));
      chip.setAttribute("aria-label", "Remove the " + name + " filter");
      chip.textContent = name + " ×";
      chip.addEventListener("click", () => {
        setSelected(selected.filter((other) => labelKey(other) !== labelKey(name)));
        input.focus();
      });
      chips.appendChild(chip);
    });
    chips.hidden = selected.length === 0;
    filterButton.classList.toggle("is-active", selected.length > 0);
    filterCount.textContent = selected.length ? String(selected.length) : "";
    filterCount.hidden = selected.length === 0;
    picker.querySelectorAll("input").forEach((box) => {
      box.checked = selected.some((name) => labelKey(name) === labelKey(box.value));
    });
  }

  function setSelected(next) {
    selected = next;
    try {
      if (selected.length) sessionStorage.setItem(STORE_KEY, JSON.stringify(selected));
      else sessionStorage.removeItem(STORE_KEY);
    } catch (error) {
      /* storage blocked — the filter just will not outlive this page */
    }
    renderChips();
    refresh();
  }

  if (hasFilter) {
    offered.forEach((entry) => {
      const row = document.createElement("label");
      row.className = "sidebar-search-label";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = entry.name;
      box.addEventListener("change", () => {
        if (box.checked) setSelected(selected.concat([entry.name]));
        else setSelected(selected.filter((name) => labelKey(name) !== labelKey(entry.name)));
      });
      const chip = document.createElement("span");
      chip.className = entry.defined === false ? "label-chip is-orphan" : "label-chip";
      chip.setAttribute("data-label-color", entry.color || "gray");
      chip.textContent = entry.name;
      row.appendChild(box);
      row.appendChild(chip);
      picker.appendChild(row);
    });
    filterButton.hidden = false;
    filterButton.addEventListener("click", () => togglePicker(picker.hidden));
    // Restore the filter this tab last used here, minus labels since removed.
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]");
      if (Array.isArray(stored)) {
        selected = stored.filter((name) =>
          offered.some((entry) => labelKey(entry.name) === labelKey(name))
        );
      }
    } catch (error) {
      selected = [];
    }
    renderChips();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      // First press dismisses the label picker or the results, the next empties
      // the box.
      if (hasFilter && !picker.hidden) {
        togglePicker(false);
      } else if (panel.hidden) {
        input.value = "";
        lastKey = "";
        input.blur();
      } else {
        close();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (panel.hidden || !items.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      const el = items[activeIndex];
      if (panel.hidden || !el) return;
      event.preventDefault();
      window.location.href = el.href;
    }
  });

  // Keep focus in the input on mousedown, so the focusout teardown below cannot
  // remove the row between mousedown and click and swallow the navigation.
  // Safari does not focus clicked links, which is where this bites hardest.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  if (more) more.addEventListener("mousedown", (event) => event.preventDefault());

  // The path is fixed when the click is dispatched, so a control that removes
  // itself on click (a filter chip) still counts as inside; root.contains would
  // see the detached node as outside and close everything.
  document.addEventListener("click", (event) => {
    if (event.composedPath().includes(root)) return;
    close();
    togglePicker(false);
  });
  root.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) close();
    }, 0);
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    input.focus();
    input.select();
  });
})();
`;

/**
 * Space ⋯ menus on the home grid: keep only one open, and close the open one
 * when the user clicks elsewhere. The <details> toggle works without JS; this
 * just adds the same dismiss behavior the sidebar page menus have.
 */
const SPACE_MENU_SCRIPT = `
(() => {
  const menus = Array.from(document.querySelectorAll(".space-menu"));
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
})();
`;

/**
 * Inline notes on the rendered page: draw the ones already saved, and let a text
 * selection become a new one.
 *
 * The renderer stamps each top-level block with `data-src-line` / `data-src-hash`
 * and lists the ids of the notes attached to it in `data-kb25-notes`; the notes
 * themselves arrive as JSON on `#kb25-notes`. Everything here is built with
 * `createElement` and text nodes — never `innerHTML` — because note text comes
 * from a file a person or an agent can write anything into.
 *
 * Note that every `\\s` below is doubled: this is a template literal, so a lone
 * backslash would be eaten and `/\s+/` would silently become `/s+/`.
 */
const NOTES_SCRIPT = `
(() => {
  const article = document.querySelector("article.prose");
  const payload = document.getElementById("kb25-notes");
  if (!article || !payload) return;

  const slug = payload.getAttribute("data-slug") || "";
  let notes = [];
  try {
    notes = JSON.parse(payload.getAttribute("data-notes") || "[]");
  } catch (err) {
    notes = [];
  }

  const byId = new Map(notes.map((note) => [note.id, note]));

  /** Collapse whitespace the same way the server does, so quotes still match. */
  function normalize(text) {
    return text.replace(/\\s+/g, " ").trim();
  }

  function relativeTime(iso) {
    const then = Date.parse(iso);
    if (!then) return "";
    const seconds = Math.max(0, (Date.now() - then) / 1000);
    const steps = [[60, "s"], [60, "m"], [24, "h"], [7, "d"], [52, "w"]];
    let value = seconds;
    let unit = "s";
    for (const [size, name] of steps) {
      if (value < size) break;
      value = value / size;
      unit = name;
    }
    return Math.floor(value) + unit + " ago";
  }

  // --- painting saved notes ------------------------------------------------

  /**
   * Wrap a note's quote in <mark>. The quote can straddle <strong>/<a>
   * boundaries, and no single element can wrap across those, so this indexes
   * every text node into one collapsed string, finds the quote there, then
   * splits and wraps each text node the match touches — one <mark> per node.
   * Returns false when the quote is gone, so the caller can degrade instead of
   * throwing.
   */
  function markQuote(block, note) {
    const wanted = normalize(note.quote);
    if (!wanted) return false;

    // Collect the whole walk before mutating: splitText() inserts siblings the
    // walker has already passed, which would otherwise be revisited.
    const nodes = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Mermaid re-reads its source from textContent on every theme flip, so
      // that text has to stay one intact node.
      if (node.parentElement && node.parentElement.closest("pre.mermaid")) continue;
      nodes.push(node);
    }

    // text[i] came from nodes[owner[i]] at character offset[i]. A run of
    // whitespace collapses onto the single space that starts it, so every
    // emitted character keeps exactly one source position.
    let text = "";
    const owner = [];
    const offset = [];
    for (let i = 0; i < nodes.length; i++) {
      const value = nodes[i].nodeValue;
      for (let j = 0; j < value.length; j++) {
        const isSpace = /\\s/.test(value[j]);
        if (isSpace && (text === "" || text.charCodeAt(text.length - 1) === 32)) continue;
        text += isSpace ? " " : value[j];
        owner.push(i);
        offset.push(j);
      }
    }

    const at = text.indexOf(wanted);
    if (at < 0) return false;

    // Group the matched characters back into one run per text node. Offsets
    // within a node only increase, so extending the last run is enough.
    const runs = [];
    for (let k = at; k < at + wanted.length; k++) {
      const last = runs.length ? runs[runs.length - 1] : null;
      if (last && last.node === owner[k]) last.end = offset[k] + 1;
      else runs.push({ node: owner[k], start: offset[k], end: offset[k] + 1 });
    }

    let marked = false;
    for (const run of runs) {
      const node = nodes[run.node];
      const length = node.nodeValue.length;
      if (run.start >= length) continue;
      const end = Math.min(run.end, length);
      // Split the head off first, then the tail, leaving exactly the match.
      const middle = run.start > 0 ? node.splitText(run.start) : node;
      if (end - run.start < middle.nodeValue.length) middle.splitText(end - run.start);
      const mark = document.createElement("mark");
      // The kind rides on the highlight itself: a task asks for a change and is
      // coloured for it, a remark is only context.
      mark.className = "note-mark is-" + note.kind;
      mark.setAttribute("data-note-mark", note.id);
      middle.parentNode.insertBefore(mark, middle);
      mark.appendChild(middle);
      marked = true;
    }
    return marked;
  }

  /**
   * Where a block's pin can legally live. A <button> is not valid as a direct
   * child of <ul>/<ol>/<table>, so it goes in the first item or cell instead —
   * which changes nothing about where it appears, because the pin positions
   * against the nearest positioned ancestor and that is still the block.
   */
  function pinHost(block) {
    const tag = block.tagName;
    if (tag === "UL" || tag === "OL") return block.querySelector("li") || block;
    if (tag === "TABLE") return block.querySelector("th, td") || block;
    return block;
  }

  /** The gutter pin for a block, created on first use. */
  function pinFor(block) {
    let pin = block.querySelector(".note-pin");
    if (pin) return pin;
    pin = document.createElement("button");
    pin.type = "button";
    pin.className = "note-pin";
    pin.setAttribute("data-note-pin", "");
    const host = pinHost(block);
    host.insertBefore(pin, host.firstChild);
    return pin;
  }

  function paint() {
    const blocks = article.querySelectorAll("[data-kb25-notes]");
    for (const block of blocks) {
      const ids = (block.getAttribute("data-kb25-notes") || "").split(" ").filter(Boolean);
      const present = ids.filter((id) => byId.has(id));
      if (!present.length) continue;

      block.classList.add("has-note");
      const kinds = present.map((id) => byId.get(id).kind);
      // One pin stands for every note on the block, so the loudest kind on it
      // wins: a single task among remarks still means something is waiting, an
      // agent note outranks a remark because it is something new said by whoever
      // last changed the page, and a highlight only colours the pin when nothing
      // else does.
      const loudest = kinds.includes("task")
        ? "task"
        : kinds.includes("agent")
          ? "agent"
          : kinds.includes("remark")
            ? "remark"
            : "highlight";
      const pin = pinFor(block);
      pin.classList.toggle("is-task", loudest === "task");
      pin.classList.toggle("is-agent", loudest === "agent");
      pin.classList.toggle("is-remark", loudest === "remark");
      pin.classList.toggle("is-highlight", loudest === "highlight");
      pin.setAttribute("aria-label", present.length + " note" + (present.length === 1 ? "" : "s"));
      pin.title = present.length === 1 ? "1 note" : present.length + " notes";

      for (const id of present) {
        const note = byId.get(id);
        if (note.quote && !markQuote(block, note)) note.drifted = true;
      }
    }
  }

  // --- the controls shared by writing and rewriting --------------------------

  /**
   * The three kinds, in the order the switch offers them and with the tooltip
   * each one carries. Highlight leads and is the default because marking a
   * passage is the most common thing to want and the only one that asks for
   * nothing: no words, no work for anyone reading the page later.
   */
  const KINDS = [
    ["highlight", "Highlight", "Marks the phrase — nothing to write"],
    ["remark", "Remark", "Context, not an instruction"],
    ["task", "Task", "Something an agent should change"],
  ];

  /**
   * What each kind is called on a card. Read from here rather than from KINDS,
   * because that table is what the switch *offers* and an agent note is the one
   * kind nobody can write: it needs a name without becoming an option.
   */
  const LABELS = { highlight: "Highlight", remark: "Remark", task: "Task", agent: "Agent" };

  /** A kind's label, falling back to Task the way the parser does. */
  function kindLabel(kind) {
    return LABELS[kind] || "Task";
  }

  /** What the text box asks for, which is nothing at all for a highlight. */
  function placeholderFor(kind) {
    if (kind === "highlight") return "Optional — a highlight needs no words";
    if (kind === "remark") return "Context worth keeping";
    return "What should change here?";
  }

  /**
   * The Highlight/Remark/Task switch. The composer and the in-place editor share
   * it, so a note can be re-typed as another kind with the same three words it
   * was first typed with. Callers read the kind() getter when they submit rather
   * than tracking the choice themselves; onChange exists only so the text box can
   * say whether it still needs filling in.
   */
  function kindPicker(current, onChange) {
    const element = document.createElement("div");
    element.className = "note-kinds";
    let kind = KINDS.some((option) => option[0] === current) ? current : "task";
    for (const option of KINDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "note-kind-option is-" + option[0] + (option[0] === kind ? " is-selected" : "");
      button.textContent = option[1];
      button.title = option[2];
      button.addEventListener("click", () => {
        kind = option[0];
        for (const sibling of element.children) {
          sibling.classList.toggle("is-selected", sibling === button);
        }
        if (onChange) onChange(kind);
      });
      element.appendChild(button);
    }
    return { element: element, kind: () => kind };
  }

  /** The note text box, prefilled when an existing note is being rewritten. */
  function noteField(text, kind) {
    const field = document.createElement("textarea");
    field.className = "note-input";
    field.rows = 3;
    field.value = text;
    field.placeholder = placeholderFor(kind);
    return field;
  }

  function actionButton(label, tone) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button " + tone;
    button.textContent = label;
    return button;
  }

  // --- the note popover ----------------------------------------------------

  let popover = null;
  let popoverAnchor = null;

  function closePopover() {
    if (!popover) return;
    popover.remove();
    popover = null;
    popoverAnchor = null;
    const active = article.querySelectorAll(".note-mark.is-active");
    for (const mark of active) mark.classList.remove("is-active");
  }

  /**
   * A note's words, with the links in them as real links.
   *
   * The server ships a note that has links as segments — runs of plain text and
   * runs that are one — with every [[wiki-link]] already resolved to where it
   * points now. A note without any ships none and is drawn as one string. Both
   * paths reach the DOM through createElement and text nodes, so a note can
   * carry a link without being able to carry markup.
   */
  function paintNoteText(target, note) {
    if (!note.segments) {
      target.textContent = note.text;
      return;
    }
    for (const segment of note.segments) {
      if (!segment.href) {
        target.appendChild(document.createTextNode(segment.text));
        continue;
      }
      const link = document.createElement("a");
      link.href = segment.href;
      link.textContent = segment.text;
      target.appendChild(link);
    }
  }

  /**
   * One note in the popover, drawn either for reading or for editing its text
   * and kind in place. Both modes come from the same function so the head —
   * kind, age, author — is identical either way and only the part below it
   * swaps; editing a note is not a different panel, it is the same card.
   */
  function noteCard(note) {
    const card = document.createElement("div");
    card.className = "note-card";

    const head = () => {
      const row = document.createElement("div");
      row.className = "note-card-head";
      const kind = document.createElement("span");
      kind.className = "note-kind is-" + note.kind;
      kind.textContent = kindLabel(note.kind);
      row.appendChild(kind);
      const when = document.createElement("span");
      when.className = "note-when";
      // The pink chip already names an agent as the writer, so printing its
      // by= line beside it would only say the same word twice.
      const by = note.kind === "agent" ? "" : note.by;
      when.textContent = [relativeTime(note.at), by].filter(Boolean).join(" · ");
      row.appendChild(when);
      return row;
    };

    const draw = (editing) => {
      card.textContent = "";
      card.appendChild(head());

      // A quote is shown here only when it could not be highlighted in the prose,
      // where it would otherwise be the one thing pointing at what drifted.
      if (note.quote && note.drifted) {
        const quote = document.createElement("div");
        quote.className = "note-quote";
        quote.textContent = "\\u201c" + note.quote + "\\u201d";
        card.appendChild(quote);
      }

      const actions = document.createElement("div");
      actions.className = "note-card-actions";

      if (editing) {
        const field = noteField(note.text, note.kind);
        card.appendChild(field);

        const picker = kindPicker(note.kind, (kind) => {
          field.placeholder = placeholderFor(kind);
        });
        actions.appendChild(picker.element);

        const cancel = actionButton("Cancel", "secondary");
        cancel.addEventListener("click", (event) => swap(false, event));
        actions.appendChild(cancel);

        const save = actionButton("Save", "primary");
        const submit = () => {
          const text = field.value.trim();
          // A highlight is the mark itself, so it is the one kind that saves with
          // an empty box — including a task or remark retyped into one, which
          // drops the words it no longer needs.
          if (!text && picker.kind() !== "highlight") {
            field.focus();
            return;
          }
          save.disabled = true;
          send({ op: "edit", noteId: note.id, text: text, kind: picker.kind() }, save);
        };
        save.addEventListener("click", submit);
        actions.appendChild(save);

        card.appendChild(actions);
        field.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          // Escape backs out of the editor and nothing more — swap() keeps the
          // keypress from the document handler, which would close the popover.
          if (event.key === "Escape") swap(false, event);
        });
        field.focus();
        return;
      }

      // A highlight has no words of its own — the mark in the prose is the whole
      // note — so the card shows its head and its actions and nothing between.
      if (note.text) {
        const body = document.createElement("div");
        body.className = "note-text";
        paintNoteText(body, note);
        card.appendChild(body);
      }

      // A note from an agent is the agent's own words: it can be taken down but
      // not have words put in its mouth, so it gets no Edit. The route refuses
      // one too — this only keeps the button from promising what it can't do.
      if (note.kind !== "agent") {
        const edit = actionButton("Edit", "secondary");
        edit.addEventListener("click", (event) => swap(true, event));
        actions.appendChild(edit);
      }

      const resolve = actionButton("Resolve", "secondary");
      resolve.addEventListener("click", () => {
        resolve.disabled = true;
        send({ op: "resolve", noteId: note.id }, resolve);
      });
      actions.appendChild(resolve);

      card.appendChild(actions);
    };

    /**
     * Change mode, then re-pin the popover for the height it now wants.
     *
     * The click that got us here is stopped short of the document: redrawing
     * detaches the very button that was clicked, and the outside-click handler
     * would then find no popover above that orphan and close the card out from
     * under the editor it just opened.
     */
    const swap = (editing, event) => {
      if (event) event.stopPropagation();
      draw(editing);
      reposition();
    };

    draw(false);
    return card;
  }

  function openPopover(anchor, ids) {
    closePopover();
    const shown = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!shown.length) return;

    popover = document.createElement("div");
    popover.className = "note-popover";
    popover.setAttribute("role", "dialog");
    for (const note of shown) popover.appendChild(noteCard(note));
    popoverAnchor = anchor;
    document.body.appendChild(popover);
    place(popover, anchor.getBoundingClientRect());
  }

  /**
   * Re-pin the popover after a card changed height. The editor is taller than
   * the note it replaces, so a popover that opened low in the window would
   * otherwise grow off the bottom of it.
   */
  function reposition() {
    if (popover && popoverAnchor) place(popover, popoverAnchor.getBoundingClientRect());
  }

  /** Pin a fixed-position panel under a rect, kept inside the viewport. */
  function place(panel, rect) {
    const width = panel.offsetWidth;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const below = rect.bottom + 8;
    const fitsBelow = below + panel.offsetHeight < window.innerHeight - 12;
    const top = fitsBelow ? below : rect.top - panel.offsetHeight - 8;
    // Neither side always fits — a note low in the window with its editor open
    // is the tall case — so the panel is pulled back inside the viewport rather
    // than left hanging over an edge.
    const lowest = Math.max(12, window.innerHeight - panel.offsetHeight - 12);
    panel.style.left = left + "px";
    panel.style.top = Math.max(12, Math.min(top, lowest)) + "px";
  }

  // --- writing ---------------------------------------------------------------

  function send(fields, button) {
    const body = new URLSearchParams(fields);
    fetch("/_notes/" + slug, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
      .then((response) => {
        // A session that expired redirects to the login page; reloading lands
        // the reader there rather than failing silently.
        if (response.redirected) {
          window.location.reload();
          return null;
        }
        return response.json().catch(() => ({ ok: false, error: "Could not save the note." }));
      })
      .then((result) => {
        if (!result) return;
        if (result.ok) window.location.reload();
        else fail(result.error || "Could not save the note.", button);
      })
      .catch(() => fail("Could not reach the server.", button));
  }

  function fail(message, button) {
    if (button) button.disabled = false;
    const toast = document.createElement("div");
    toast.className = "toast is-error";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 320);
    }, 3200);
  }

  // --- composing from a selection --------------------------------------------

  let pending = null;
  let addButton = null;
  let composer = null;

  /**
   * The current selection as an anchor, or null. A selection is clipped to the
   * block that holds its start: a quote spanning two blocks is text no single
   * block contains, so it could never be found again.
   */
  function selectionAnchor() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return null;

    let node = range.startContainer;
    if (node.nodeType === 1 && range.startOffset < node.childNodes.length) {
      node = node.childNodes[range.startOffset];
    }
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    const block = element && element.closest ? element.closest("[data-src-line]") : null;
    if (!block || !article.contains(block)) return null;

    const clipped = range.cloneRange();
    if (!block.contains(clipped.startContainer)) clipped.setStart(block, 0);
    if (!block.contains(clipped.endContainer)) clipped.setEnd(block, block.childNodes.length);

    const quote = normalize(clipped.toString());
    if (!quote) return null;

    return {
      line: block.getAttribute("data-src-line"),
      hash: block.getAttribute("data-src-hash"),
      quote: quote,
      rect: clipped.getBoundingClientRect(),
    };
  }

  function hideAddButton() {
    if (addButton) addButton.remove();
    addButton = null;
  }

  function showAddButton(anchor) {
    hideAddButton();
    addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "note-add";
    addButton.textContent = "Add note";
    // Without this the button's own mousedown collapses the selection before
    // the click handler ever sees it.
    addButton.addEventListener("mousedown", (event) => event.preventDefault());
    addButton.addEventListener("click", () => openComposer(anchor));
    document.body.appendChild(addButton);
    place(addButton, anchor.rect);
  }

  function closeComposer() {
    if (composer) composer.remove();
    composer = null;
  }

  function openComposer(anchor) {
    hideAddButton();
    closeComposer();
    closePopover();

    composer = document.createElement("div");
    composer.className = "note-composer";

    const quote = document.createElement("div");
    quote.className = "note-quote";
    quote.textContent = "\\u201c" + anchor.quote + "\\u201d";
    composer.appendChild(quote);

    const field = noteField("", "highlight");
    composer.appendChild(field);

    const row = document.createElement("div");
    row.className = "note-composer-actions";

    const picker = kindPicker("highlight", (kind) => {
      field.placeholder = placeholderFor(kind);
    });
    row.appendChild(picker.element);

    const cancel = actionButton("Cancel", "secondary");
    cancel.addEventListener("click", closeComposer);
    row.appendChild(cancel);

    const save = actionButton("Save", "primary");
    const submit = () => {
      const text = field.value.trim();
      // Highlight is the default kind, so Save straight after selecting a phrase
      // marks it and nothing else — which is the point of having the kind.
      if (!text && picker.kind() !== "highlight") {
        field.focus();
        return;
      }
      save.disabled = true;
      send(
        {
          op: "add",
          line: anchor.line,
          hash: anchor.hash,
          quote: anchor.quote,
          text: text,
          kind: picker.kind(),
        },
        save
      );
    };
    save.addEventListener("click", submit);
    row.appendChild(save);

    composer.appendChild(row);
    // Cmd/Ctrl+Enter saves, matching the editor's Cmd/Ctrl+S habit.
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
      if (event.key === "Escape") closeComposer();
    });

    document.body.appendChild(composer);
    place(composer, anchor.rect);
    field.focus();
  }

  // --- arriving at one particular note ---------------------------------------

  /**
   * Open the note named by a \`#note-<id>\` fragment, which is how the dashboard
   * links to a single task rather than to the top of its page.
   *
   * The anchor is found by walking the candidates and splitting their attribute,
   * the way paint() does, rather than with a \`~=\` selector: a hand-written note
   * gets a positional \`@<line>\` id, which would need escaping to be a valid one.
   * A note that is already resolved leaves the page alone.
   */
  function focusFromHash() {
    // A real element with this id wins. Heading ids share the fragment
    // namespace with \`#note-<id>\`, so a heading called "Note 3f2a91bc" has to
    // scroll to itself rather than open a note that happens to share the tail.
    if (location.hash.length > 1 && document.getElementById(location.hash.slice(1))) return;
    const raw = (location.hash || "").replace(/^#note-/, "");
    if (!raw || raw === location.hash) return;
    // A positional \`@<line>\` id arrives percent-encoded, so the fragment has to
    // be decoded before it can be looked up.
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch (err) {
      id = raw;
    }
    if (!byId.has(id)) return;

    let anchor = null;
    for (const mark of article.querySelectorAll("[data-note-mark]")) {
      if (mark.getAttribute("data-note-mark") === id) {
        anchor = mark;
        break;
      }
    }
    if (anchor) {
      for (const mark of article.querySelectorAll("[data-note-mark]")) {
        if (mark.getAttribute("data-note-mark") === id) mark.classList.add("is-active");
      }
    } else {
      for (const block of article.querySelectorAll("[data-kb25-notes]")) {
        const ids = (block.getAttribute("data-kb25-notes") || "").split(" ").filter(Boolean);
        if (ids.indexOf(id) >= 0) {
          anchor = block.querySelector(".note-pin");
          break;
        }
      }
    }
    if (!anchor) return;

    anchor.scrollIntoView({ block: "center" });
    // After the scroll, so the popover is placed against the rect the anchor
    // ends up with rather than the one it was at.
    openPopover(anchor, [id]);
  }

  // --- wiring ----------------------------------------------------------------

  paint();
  focusFromHash();
  window.addEventListener("hashchange", focusFromHash);

  function offerSelection() {
    if (composer) return; // the composer owns the selection it was opened with
    pending = selectionAnchor();
    if (pending) showAddButton(pending);
    else hideAddButton();
  }

  // The button waits for the mouse to come up. Shown mid-drag, it sat right in
  // the path of a downward drag, and the pointer crossing it moved the
  // selection's end to where the button is in the document — the end of
  // <body> — so the selection flooded to the bottom of the page and back on
  // every move. A keyboard selection has no drag and still shows it at once.
  let dragging = false;

  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".note-add")) return;
    dragging = true;
    hideAddButton();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    offerSelection();
  });
  // Dragging selected text away ends in dragend, with no mouseup.
  document.addEventListener("dragend", () => {
    dragging = false;
  });

  document.addEventListener("selectionchange", () => {
    if (!dragging) offerSelection();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".note-popover, .note-composer, .note-add")) return;

    const pin = target.closest("[data-note-pin]");
    if (pin) {
      const block = pin.closest("[data-kb25-notes]");
      const ids = (block.getAttribute("data-kb25-notes") || "").split(" ").filter(Boolean);
      openPopover(pin, ids);
      return;
    }

    const mark = target.closest("[data-note-mark]");
    if (mark) {
      const id = mark.getAttribute("data-note-mark");
      const marks = article.querySelectorAll('[data-note-mark="' + id + '"]');
      for (const sibling of marks) sibling.classList.add("is-active");
      openPopover(mark, [id]);
      return;
    }

    closePopover();
    closeComposer();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closePopover();
    closeComposer();
    hideAddButton();
  });
})();
`;

/**
 * The folder dialog: one form that names a new folder or renames one. The
 * Create button stays disabled until there is a name (and, renaming, until it
 * differs from the current one); the letters-or-digits check mirrors the
 * server, which builds the folder's address from them, so the person hears
 * about it here rather than on an error page.
 */
const FOLDER_DIALOG_SCRIPT = `
(function () {
  var dialog = document.querySelector("[data-folder-dialog]");
  if (!dialog) return;
  var form = dialog.querySelector("[data-folder-form]");
  var heading = dialog.querySelector("[data-folder-heading]");
  var input = dialog.querySelector("[data-folder-name]");
  var hint = dialog.querySelector("[data-folder-hint]");
  var error = dialog.querySelector("[data-folder-error]");
  var parentField = dialog.querySelector("[data-folder-parent-field]");
  var slugField = dialog.querySelector("[data-folder-slug-field]");
  var submit = dialog.querySelector("[data-folder-submit]");
  var mode = "create";
  var original = "";

  function showError(text) {
    error.textContent = text || "";
    error.hidden = !text;
    input.setAttribute("aria-invalid", text ? "true" : "false");
  }

  function problem(name) {
    if (!name) return "Enter a name for the folder.";
    if (!/[a-z0-9]/i.test(name)) {
      return "Use at least one letter or number (A–Z, 0–9) — the folder's address is made from them.";
    }
    return "";
  }

  function sync() {
    var name = input.value.trim();
    submit.disabled = !name || (mode === "rename" && name === original);
    if (!error.hidden && !problem(name)) showError("");
  }

  function hide() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function show(trigger, nextMode) {
    mode = nextMode;
    showError("");
    if (mode === "create") {
      form.action = "/_create-folder";
      heading.textContent = "New folder";
      submit.textContent = "Create folder";
      parentField.disabled = false;
      parentField.value = trigger.getAttribute("data-folder-parent") || "";
      slugField.disabled = true;
      slugField.value = "";
      original = "";
      input.value = "";
      var where = trigger.getAttribute("data-folder-parent-title") || "";
      hint.textContent = where ? "It will be created inside " + where + "." : "";
    } else {
      form.action = "/_rename-folder";
      heading.textContent = "Rename folder";
      submit.textContent = "Rename";
      parentField.disabled = true;
      parentField.value = "";
      slugField.disabled = false;
      slugField.value = trigger.getAttribute("data-folder-slug") || "";
      original = trigger.getAttribute("data-folder-title") || "";
      input.value = original;
      hint.textContent = "Only the name shown in the sidebar changes; the folder keeps its address.";
    }
    hint.hidden = !hint.textContent;
    var menu = trigger.closest("details");
    if (menu) menu.open = false;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    input.focus();
    input.select();
    sync();
  }

  input.addEventListener("input", sync);

  form.addEventListener("submit", function (event) {
    var name = input.value.trim();
    var why = problem(name);
    if (why) {
      event.preventDefault();
      showError(why);
      input.focus();
      return;
    }
    if (mode === "rename" && name === original) {
      event.preventDefault();
      hide();
      return;
    }
    input.value = name;
    // One click, one folder: a second press while the first is in flight
    // would create a sibling with a -2 address.
    submit.disabled = true;
    submit.textContent = mode === "create" ? "Creating…" : "Renaming…";
  });

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var create = target.closest("[data-folder-new]");
    if (create) {
      event.preventDefault();
      show(create, "create");
      return;
    }
    var rename = target.closest("[data-folder-rename]");
    if (rename) {
      event.preventDefault();
      show(rename, "rename");
      return;
    }
    if (target.closest("[data-folder-close]")) {
      event.preventDefault();
      hide();
    }
  });

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) hide();
  });

  // Coming Back to this page from the folder just made restores it from the
  // back-forward cache with the dialog still open on "Creating…".
  window.addEventListener("pageshow", function (event) {
    if (event.persisted && dialog.open) hide();
  });
})();
`;

/**
 * The label dialog. A row's "Labels" item opens it for that page: the list is
 * rebuilt from the palette plus whatever the page already carries (an orphan
 * stays listed so it can be unticked), built with createElement and
 * textContent only — label names were typed by people and agents. Saving is
 * an ordinary form post that lands back on this page.
 */
const LABELS_SCRIPT = `
(function () {
  var dialog = document.querySelector("[data-label-dialog]");
  if (!dialog) return;
  var form = dialog.querySelector("form");
  var list = dialog.querySelector("[data-label-list]");
  var none = dialog.querySelector("[data-label-none]");
  var slugInput = dialog.querySelector("[data-label-slug]");
  var returnInput = dialog.querySelector("[data-label-return]");
  var pageName = dialog.querySelector("[data-label-page]");
  var nameInput = form.querySelector("input[name=newName]");
  var palette = [];
  try {
    palette = JSON.parse(dialog.getAttribute("data-label-palette") || "[]");
  } catch (error) {
    palette = [];
  }

  function key(name) {
    return String(name).trim().normalize("NFC").toLowerCase();
  }

  function chip(entry) {
    var span = document.createElement("span");
    span.className = entry.defined === false ? "label-chip is-orphan" : "label-chip";
    span.setAttribute("data-label-color", entry.color || "gray");
    span.textContent = entry.name;
    return span;
  }

  function fill(current) {
    Array.prototype.slice.call(list.querySelectorAll(".label-option")).forEach(function (row) {
      row.remove();
    });
    var on = {};
    current.forEach(function (name) { on[key(name)] = true; });
    var seen = {};
    var rows = [];
    palette.forEach(function (entry) {
      seen[key(entry.name)] = true;
      rows.push(entry);
    });
    current.forEach(function (name) {
      if (seen[key(name)]) return;
      seen[key(name)] = true;
      rows.push({ name: name, color: "gray", defined: false });
    });
    rows.forEach(function (entry) {
      var row = document.createElement("label");
      row.className = "label-option";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.name = "label";
      box.value = entry.name;
      box.checked = !!on[key(entry.name)];
      row.appendChild(box);
      row.appendChild(chip(entry));
      list.appendChild(row);
    });
    list.hidden = rows.length === 0;
    none.hidden = rows.length !== 0;
  }

  function show(button) {
    var current = [];
    try {
      current = JSON.parse(button.getAttribute("data-label-current") || "[]");
    } catch (error) {
      current = [];
    }
    slugInput.value = button.getAttribute("data-label-slug") || "";
    returnInput.value = location.pathname + location.search;
    pageName.textContent = button.getAttribute("data-label-title") || "";
    nameInput.value = "";
    var gray = form.querySelector("input[name=newColor][value=gray]");
    if (gray) gray.checked = true;
    fill(current);
    var menu = button.closest("details");
    if (menu) menu.open = false;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    var first = list.hidden ? null : list.querySelector("input");
    (first || nameInput).focus();
  }

  function hide() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var opener = target.closest("[data-label-open]");
    if (opener) {
      event.preventDefault();
      show(opener);
      return;
    }
    if (target.closest("[data-label-close]")) {
      event.preventDefault();
      hide();
    }
  });

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) hide();
  });
})();
`;

/**
 * Ticking a label in the Labels view applies it at once. The form already
 * works with scripts off (tick, then Search); this only saves the click.
 */
const LABEL_FILTER_SCRIPT = `
(function () {
  var form = document.querySelector("[data-label-filter]");
  if (!form) return;
  form.addEventListener("change", function (event) {
    var target = event.target;
    if (!target || target.type !== "checkbox") return;
    if (form.requestSubmit) form.requestSubmit();
    else form.submit();
  });
})();
`;

/**
 * Label swatches: chip background, chip ink, and a solid dot, per theme. The
 * light pairs are a pale tint under dark ink; the dark ones a deep tint under
 * pale ink — each clears 4.5:1, so a chip stays readable whichever theme is on.
 */
const LABEL_SWATCHES: Record<LabelColor, { light: [string, string, string]; dark: [string, string, string] }> = {
  gray: { light: ["#f3f4f6", "#374151", "#9ca3af"], dark: ["#30363d", "#d1d5db", "#8b949e"] },
  red: { light: ["#fee2e2", "#991b1b", "#ef4444"], dark: ["#4c1414", "#fecaca", "#f87171"] },
  orange: { light: ["#ffedd5", "#9a3412", "#f97316"], dark: ["#4a2410", "#fed7aa", "#fb923c"] },
  yellow: { light: ["#fef9c3", "#854d0e", "#eab308"], dark: ["#42340a", "#fef08a", "#facc15"] },
  green: { light: ["#dcfce7", "#166534", "#22c55e"], dark: ["#12361f", "#bbf7d0", "#4ade80"] },
  teal: { light: ["#ccfbf1", "#115e59", "#14b8a6"], dark: ["#123c38", "#99f6e4", "#2dd4bf"] },
  blue: { light: ["#dbeafe", "#1e40af", "#3b82f6"], dark: ["#172554", "#bfdbfe", "#60a5fa"] },
  purple: { light: ["#f3e8ff", "#6b21a8", "#a855f7"], dark: ["#3b1764", "#e9d5ff", "#c084fc"] },
  pink: { light: ["#fce7f3", "#9d174d", "#ec4899"], dark: ["#4a1230", "#fbcfe8", "#f472b6"] },
  brown: { light: ["#f1e7dc", "#5c3a1e", "#a0714a"], dark: ["#3a2817", "#ead7c3", "#c08a5b"] },
};

/** The `--label-<colour>-*` custom properties for one theme block. */
function labelTokens(theme: "light" | "dark"): string {
  return LABEL_COLORS.map((color) => {
    const [bg, fg, dot] = LABEL_SWATCHES[color][theme];
    return `--label-${color}-bg:${bg}; --label-${color}-fg:${fg}; --label-${color}-dot:${dot};`;
  }).join("\n  ");
}

/** Point a chip or dot's working colours at the swatch its data-label-color names. */
const LABEL_COLOR_RULES = LABEL_COLORS.map(
  (color) =>
    `[data-label-color="${color}"]{--lc-bg:var(--label-${color}-bg); --lc-fg:var(--label-${color}-fg); --lc-dot:var(--label-${color}-dot)}`
).join("\n");

const STYLES = `
:root{
  color-scheme:light;
  --bg:#fff; --fg:#1f2328; --muted:#6b7280; --line:#e5e7eb;
  --accent:#2563eb; --on-accent:#fff; --sidebar:#f7f8fa; --code-bg:#f6f8fa;
  /* The halo around a fresh page's dot in the sidebar: the accent, softened. */
  --fresh-glow:rgba(37,99,235,.55);
  --maxw:1216px;
  --fg-secondary:#374151;
  --surface:#fff; --surface-hover:#eef0f3; --surface-hover-2:#f7f8fa;
  --active-bg:#e7efff; --selected-bg:#dbeafe;
  --mark-bg:#fde68a; --mark-bg-strong:#fcd34d; --mark-fg:#713f12;
  /* A note is teal by default, which is what a remark keeps… */
  --note-bg:#ccfbf1; --note-bg-strong:#99f6e4; --note-fg:#115e59;
  --note-pin:#0d9488; --note-border:#5eead4;
  /* …a task is purple, because it asks for a change and should read as one… */
  --task-bg:#f3e8ff; --task-bg-strong:#e9d5ff; --task-fg:#6b21a8;
  --task-pin:#a855f7; --task-border:#d8b4fe;
  /* …and a highlight is the flat yellow of a highlighter pen, undiluted, because
     a washed-out yellow reads as stained paper rather than as a mark someone
     made. The ink is a dark olive of the same hue, not the brown of the amber
     search mark: the two now say "look here" in visibly different voices. */
  --highlight-bg:#fbff00; --highlight-bg-strong:#e9ed00; --highlight-fg:#3d4000;
  --highlight-pin:#9aa300; --highlight-border:#d8dd00;
  /* An agent note is pink: the one kind the reader did not write, so it wants a
     hue none of theirs uses. Magenta-leaning rather than rose, which keeps it
     off the pale red of the destructive buttons, and carrying more saturation
     than a task's tint, which is what keeps it off that tint's pale lavender —
     the two are hard to tell apart once both are washed out. The only kind
     whose pin needs no per-theme value: this reads on white and on black. */
  --agent-bg:#ffc9e6; --agent-bg-strong:#ffa8d6; --agent-fg:#6b0038;
  --agent-pin:#ff2d87; --agent-border:#ff8ec9;
  --focus-ring:#93c5fd; --focus-ring-soft:#bfdbfe;
  --sidebar-fade:rgba(247,248,250,0); --surface-hover-fade:rgba(238,240,243,0); --active-fade:rgba(231,239,255,0);
  --shadow-sm:0 2px 8px rgba(0,0,0,.08);
  --shadow-md:0 2px 8px rgba(0,0,0,.12);
  --shadow-lg:0 8px 30px rgba(0,0,0,.18);
  --shadow-card:0 1px 4px rgba(0,0,0,.06);
  --backdrop:rgba(15,23,42,.35);
  --diff-add-fg:#166534; --diff-add-bg:#dcfce7;
  --diff-del-fg:#991b1b; --diff-del-bg:#fee2e2;
  --error-fg:#991b1b; --error-bg:#fef2f2; --error-border:#fecaca;
  --success-fg:#166534; --success-bg:#f0fdf4; --success-border:#bbf7d0;
  --warning-fg:#92400e; --warning-bg:#fffbeb; --warning-border:#fde68a;
  --badge-web-fg:#1e40af; --badge-web-bg:#e7efff; --badge-web-border:#c7d7fe;
  --badge-mcp-fg:#6b21a8; --badge-mcp-bg:#f3e8ff; --badge-mcp-border:#e2ccf9;
  --hl-comment:#6a737d; --hl-keyword:#d73a49; --hl-string:#032f62;
  --hl-number:#005cc5; --hl-title:#6f42c1; --hl-attr:#e36209;
  ${labelTokens("light")}
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d;
  --accent:#4493f8; --on-accent:#0d1117; --sidebar:#0b0e14; --code-bg:#161b22;
  --fresh-glow:rgba(68,147,248,.6);
  --fg-secondary:#c9d1d9;
  --surface:#161b22; --surface-hover:#21262d; --surface-hover-2:#21262d;
  --active-bg:#1f2d44; --selected-bg:#253a5e;
  --mark-bg:#5c4708; --mark-bg-strong:#7a5f0a; --mark-fg:#f5d67b;
  --note-bg:#134e4a; --note-bg-strong:#115e59; --note-fg:#99f6e4;
  --note-pin:#2dd4bf; --note-border:#0f766e;
  --task-bg:#4c1d95; --task-bg-strong:#5b21b6; --task-fg:#e9d5ff;
  --task-pin:#a855f7; --task-border:#6d28d9;
  --highlight-bg:#4a4d00; --highlight-bg-strong:#5f6300; --highlight-fg:#edf37a;
  --highlight-pin:#e2e800; --highlight-border:#6f7400;
  --agent-bg:#5c0f36; --agent-bg-strong:#7a1548; --agent-fg:#ffc9e6;
  --agent-pin:#ff2d87; --agent-border:#a31e5e;
  --focus-ring:#388bfd; --focus-ring-soft:#1f6feb;
  --sidebar-fade:rgba(11,14,20,0); --surface-hover-fade:rgba(33,38,45,0); --active-fade:rgba(31,45,68,0);
  --shadow-sm:0 2px 8px rgba(0,0,0,.5);
  --shadow-md:0 2px 8px rgba(0,0,0,.6);
  --shadow-lg:0 8px 30px rgba(0,0,0,.7);
  --shadow-card:0 1px 4px rgba(0,0,0,.5);
  --backdrop:rgba(1,4,9,.6);
  --diff-add-fg:#7ee787; --diff-add-bg:#12261a;
  --diff-del-fg:#ffa198; --diff-del-bg:#2d1213;
  --error-fg:#ff7b72; --error-bg:#2d1213; --error-border:#5c1a1a;
  --success-fg:#56d364; --success-bg:#12261a; --success-border:#1a4023;
  --warning-fg:#e3b341; --warning-bg:#2b2411; --warning-border:#4a3b12;
  --badge-web-fg:#a8c7fa; --badge-web-bg:#172554; --badge-web-border:#1e3a8a;
  --badge-mcp-fg:#d8b4fe; --badge-mcp-bg:#2e1065; --badge-mcp-border:#4c1d95;
  --hl-comment:#8b949e; --hl-keyword:#ff7b72; --hl-string:#a5d6ff;
  --hl-number:#79c0ff; --hl-title:#d2a8ff; --hl-attr:#ffa657;
  ${labelTokens("dark")}
}
/* No-JS fallback: honor the OS setting when no explicit choice was made. */
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]){
    color-scheme:dark;
    --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d;
    --accent:#4493f8; --on-accent:#0d1117; --sidebar:#0b0e14; --code-bg:#161b22;
    --fresh-glow:rgba(68,147,248,.6);
    --fg-secondary:#c9d1d9;
    --surface:#161b22; --surface-hover:#21262d; --surface-hover-2:#21262d;
    --active-bg:#1f2d44; --selected-bg:#253a5e;
    --mark-bg:#5c4708; --mark-bg-strong:#7a5f0a; --mark-fg:#f5d67b;
    --note-bg:#134e4a; --note-bg-strong:#115e59; --note-fg:#99f6e4;
    --note-pin:#2dd4bf; --note-border:#0f766e;
    --task-bg:#4c1d95; --task-bg-strong:#5b21b6; --task-fg:#e9d5ff;
    --task-pin:#a855f7; --task-border:#6d28d9;
    --highlight-bg:#4a4d00; --highlight-bg-strong:#5f6300; --highlight-fg:#edf37a;
    --highlight-pin:#e2e800; --highlight-border:#6f7400;
    --agent-bg:#5c0f36; --agent-bg-strong:#7a1548; --agent-fg:#ffc9e6;
    --agent-pin:#ff2d87; --agent-border:#a31e5e;
    --focus-ring:#388bfd; --focus-ring-soft:#1f6feb;
    --sidebar-fade:rgba(11,14,20,0); --surface-hover-fade:rgba(33,38,45,0); --active-fade:rgba(31,45,68,0);
    --shadow-sm:0 2px 8px rgba(0,0,0,.5);
    --shadow-md:0 2px 8px rgba(0,0,0,.6);
    --shadow-lg:0 8px 30px rgba(0,0,0,.7);
    --shadow-card:0 1px 4px rgba(0,0,0,.5);
    --backdrop:rgba(1,4,9,.6);
    --diff-add-fg:#7ee787; --diff-add-bg:#12261a;
    --diff-del-fg:#ffa198; --diff-del-bg:#2d1213;
    --error-fg:#ff7b72; --error-bg:#2d1213; --error-border:#5c1a1a;
    --success-fg:#56d364; --success-bg:#12261a; --success-border:#1a4023;
    --warning-fg:#e3b341; --warning-bg:#2b2411; --warning-border:#4a3b12;
    --badge-web-fg:#a8c7fa; --badge-web-bg:#172554; --badge-web-border:#1e3a8a;
    --badge-mcp-fg:#d8b4fe; --badge-mcp-bg:#2e1065; --badge-mcp-border:#4c1d95;
    --hl-comment:#8b949e; --hl-keyword:#ff7b72; --hl-string:#a5d6ff;
    --hl-number:#79c0ff; --hl-title:#d2a8ff; --hl-attr:#ffa657;
    ${labelTokens("dark")}
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--fg); background:var(--bg); display:flex; min-height:100vh;
}
a{color:var(--accent); text-decoration:none}
a:hover{text-decoration:underline}
.sidebar{
  width:300px; flex:0 0 300px; background:var(--sidebar);
  border-right:1px solid var(--line); padding:20px 16px; position:sticky; top:0;
  height:100vh; overflow:auto;
}
.brand{display:block; font-weight:700; font-size:15px; color:var(--fg);
  margin-bottom:16px; letter-spacing:.2px}
.brand:hover{text-decoration:none}
.sidebar-link{
  display:block; margin:0 0 14px; padding:4px 6px; border-radius:6px;
  color:var(--fg-secondary); font-size:14px; font-weight:600;
}
.sidebar-link:hover{background:var(--surface-hover); text-decoration:none}
.sidebar-link.active{background:var(--active-bg); color:var(--accent)}
/* "Create" disclosure: a sidebar link that reveals Page / Folder choices. */
.create-menu{margin:0 0 14px}
.create-menu>summary{margin:0; list-style:none; cursor:pointer}
.create-menu>summary::-webkit-details-marker{display:none}
.create-menu>summary::marker{content:""}
.create-menu-pop{
  margin:6px 0 0; padding:4px; display:flex; flex-direction:column;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-sm);
}
.create-menu-pop form{margin:0}
.create-menu-pop button{
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:6px 8px; border-radius:4px; color:var(--fg-secondary); font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit;
}
.create-menu-pop button:hover{background:var(--surface-hover)}
/* Inline name form (space rename) in the home grid's space ⋯ menu. */
.menu-name-form{display:flex; flex-direction:column; gap:4px; margin:0}
.menu-name-form input[type=text]{
  width:100%; box-sizing:border-box; padding:5px 7px; font-size:13px;
  color:var(--fg); background:var(--surface);
  border:1px solid var(--line); border-radius:4px;
}
/* Folder contents view */
.folder-tag{
  display:inline-block; padding:2px 8px; border-radius:999px;
  background:var(--surface-hover); color:var(--muted); font-size:12px; font-weight:600;
}
.folder-view{margin-top:8px}
.folder-create{display:flex; gap:10px; flex-wrap:wrap; align-items:flex-start; margin-bottom:18px}
.folder-create form{margin:0}
.folder-list{list-style:none; padding:0; margin:0; border-top:1px solid var(--line)}
.folder-list li{
  display:flex; align-items:center; gap:6px; padding:9px 4px;
  border-bottom:1px solid var(--line);
}
.folder-list li>a{font-weight:600}
.folder-empty{color:var(--muted); margin:18px 0}
/* Sidebar search: combobox + result panel, scoped to the current space. */
.sidebar-search{position:relative; margin:0 0 14px}
.sidebar-search-input{
  width:100%; padding:6px 8px; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--fg); font-size:14px; font-family:inherit;
}
.sidebar-search-input::placeholder{color:var(--muted)}
.sidebar-search-input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
/* Drop WebKit's native clear button so Esc is the one dismiss gesture. */
.sidebar-search-input::-webkit-search-cancel-button{-webkit-appearance:none; appearance:none}
/* The sidebar is the scroll container, so this panel is clipped to it; the input
   sits near the top of a 100vh column, which leaves room for the max-height. */
.sidebar-search-panel{
  position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:20;
  max-height:min(60vh,420px); overflow:auto; padding:4px;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-md);
}
.sidebar-search-item{
  display:block; padding:6px 8px; border-radius:4px; color:var(--fg-secondary);
  overflow-wrap:anywhere; cursor:pointer;
}
.sidebar-search-item:hover{background:var(--surface-hover); text-decoration:none}
.sidebar-search-item.is-active{background:var(--active-bg)}
.sidebar-search-item.is-active .sidebar-search-title{color:var(--accent)}
.sidebar-search-title{display:block; font-size:14px; font-weight:600; color:var(--fg)}
.sidebar-search-crumb{display:block; font-size:11px; color:var(--muted); margin-top:1px}
.sidebar-search-excerpt{
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
  font-size:12px; color:var(--muted); margin-top:3px; line-height:1.45;
}
/* Yellow highlight, but the browser default (black on bright yellow) is
   unreadable on a dark surface, so it rides tokens that flip with the theme. */
.sidebar-search-item mark{
  background:var(--mark-bg); color:var(--mark-fg); font-weight:600;
  border-radius:2px; padding:0 1px;
}
.sidebar-search-item.is-active mark{background:var(--mark-bg-strong)}
.sidebar-search-status{padding:6px 8px; font-size:12px; color:var(--muted)}
.sidebar-search-status[hidden]{display:none}
/* The label filter: a funnel inside the field, the picked labels as removable
   chips under it, and the picker in the flow below (the results panel floats
   beneath all three). */
.sidebar-search-field{position:relative}
.sidebar-search-field .sidebar-search-input{padding-right:40px}
.sidebar-search-filter{
  position:absolute; right:4px; top:50%; transform:translateY(-50%);
  display:inline-flex; align-items:center; gap:2px; height:24px; padding:0 5px;
  border:0; border-radius:4px; background:transparent; color:var(--muted); cursor:pointer;
}
.sidebar-search-filter[hidden]{display:none}
.sidebar-search-filter:hover,.sidebar-search-filter[aria-expanded="true"]{background:var(--surface-hover); color:var(--fg)}
.sidebar-search-filter.is-active{color:var(--accent)}
.sidebar-search-filter:focus-visible{outline:2px solid var(--focus-ring-soft)}
.sidebar-search-filter svg{display:block}
.sidebar-search-filter-count{font-size:11px; font-weight:700; line-height:1}
.sidebar-search-chips{display:flex; flex-wrap:wrap; gap:4px; margin-top:6px}
.sidebar-search-chips[hidden]{display:none}
.sidebar-search-chip{cursor:pointer; font-family:inherit}
.sidebar-search-chip:hover{border-color:var(--lc-dot)}
.sidebar-search-picker{
  display:flex; flex-direction:column; gap:1px; margin-top:6px; padding:4px;
  max-height:220px; overflow:auto;
  border:1px solid var(--line); border-radius:6px; background:var(--surface);
}
.sidebar-search-picker[hidden]{display:none}
.sidebar-search-label{
  display:flex; align-items:center; gap:6px; padding:3px 6px; border-radius:4px;
  cursor:pointer; font-size:13px;
}
.sidebar-search-label:hover{background:var(--surface-hover)}
.sidebar-search-label input{margin:0}
.sidebar-search-dots{display:inline-flex; align-items:center; gap:3px; margin-left:6px; vertical-align:middle}
.sidebar-search-more{
  display:block; margin-top:4px; padding:6px 8px; border-top:1px solid var(--line);
  font-size:12px; font-weight:600;
}
.sidebar-search-more[hidden]{display:none}
.move-error{
  margin:0 0 14px; padding:8px 10px; border:1px solid var(--error-border);
  border-radius:6px; background:var(--error-bg); color:var(--error-fg); font-size:13px;
}
/* The trailing padding is the overshoot room for a drag aimed at the end of the
   tree: it belongs to the nav, so MOVE_SCRIPT still sees the drag and reads it as
   "append to the space root" instead of letting the page slip past the last row. */
.tree{padding-bottom:24px}
.tree ul{list-style:none; margin:0; padding:0}
.tree .children{margin-left:12px; border-left:1px solid var(--line); padding-left:8px}
.tree a,.tree-label{display:block; padding:3px 6px; border-radius:6px; color:var(--fg-secondary); font-size:14px; overflow-wrap:anywhere; user-select:none}
.tree-label{color:var(--muted); font-weight:600}
.tree a:hover{background:var(--surface-hover); text-decoration:none}
.tree a.active{background:var(--active-bg); color:var(--accent); font-weight:600}
.tree a.selected{background:var(--selected-bg); box-shadow:inset 2px 0 0 var(--accent)}
.tree a[draggable="true"]{cursor:grab}
.tree a.drag-source{opacity:.55}
.tree a.drop-target-active,.space-current.drop-target-active{
  outline:2px solid var(--focus-ring); outline-offset:1px; background:var(--active-bg);
}
/* MOVE_SCRIPT flags the body while a page is in flight. Hinting the space name
   then recovers the affordance the always-visible dashed drop strip provided,
   without spending sidebar space on it the rest of the time. */
body.dragging-page .space-current{
  outline:1px dashed var(--line); outline-offset:2px; border-radius:4px;
}
/* Insertion points between rows. Zero height so the tree keeps its rhythm, and
   the indicator is drawn by a pseudo-element, so the pointer is never "over" a
   line — MOVE_SCRIPT picks one from the row edge under the cursor instead. The
   line inherits its group's indentation, which is what tells the reader which
   group it would drop into where two of them meet at the same height (the
   indicator moves between the two as the cursor crosses that boundary). */
/* pointer-events:none is load-bearing: the 2px indicator below straddles the
   boundary between two rows, and it would otherwise win the hit test over the
   very row edge the pointer is aiming at, swallowing the dragover. */
.tree .drop-line{position:relative; height:0; pointer-events:none}
.tree .drop-line::before{
  content:""; position:absolute; left:0; right:2px; top:-1px; height:2px;
  border-radius:2px; background:var(--accent); opacity:0;
}
.tree .drop-line.drop-line-active::before{opacity:1}
.tree-toggle{
  flex:0 0 auto; width:18px; height:24px; margin:0; padding:0; border:0;
  background:transparent; cursor:pointer; color:var(--muted);
  display:flex; align-items:center; justify-content:center; line-height:1;
}
.tree-toggle::before{content:"\\25B6"; font-size:9px; transition:transform .12s ease; transform:rotate(90deg)}
.tree li.collapsed > .tree-row .tree-toggle::before{transform:rotate(0deg)}
.tree-toggle:hover{color:var(--fg)}
.tree-toggle-spacer{flex:0 0 auto; width:18px}
.tree-folder-icon{flex:0 0 auto; width:14px; height:14px; margin-right:2px; color:var(--muted)}
/* Shares the marker column with .tree-toggle: the 2px side margins centre the
   14px glyph inside the same 18px box, so the dot and the caret sit on one
   vertical axis. Widths here and on .tree-toggle must stay in step. */
.tree-page-dot{flex:0 0 auto; width:14px; height:14px; margin:0 2px; color:var(--muted); opacity:.55}
.tree li.collapsed > .children{display:none}
.tree-row{position:relative; display:flex; align-items:center}
.tree-row>a{
  flex:1; min-width:0;
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
}
.tree-menu{position:absolute; right:0; top:0; flex:0 0 auto}
.tree-menu summary{
  list-style:none; cursor:pointer; user-select:none; opacity:0; pointer-events:none;
  display:flex; align-items:center; justify-content:flex-end;
  height:29px; padding:0 6px 0 24px; border-radius:6px;
  color:var(--muted); font-size:14px; line-height:1;
  background:linear-gradient(to right, var(--sidebar-fade) 0, var(--sidebar) 18px);
}
.tree-menu summary::-webkit-details-marker{display:none}
.tree-row:hover .tree-menu summary,.tree-row:focus-within .tree-menu summary,.tree-menu[open] summary{
  opacity:1; pointer-events:auto;
}
.tree-row:hover .tree-menu summary,.tree-row:focus-within .tree-menu summary{
  background:linear-gradient(to right, var(--surface-hover-fade) 0, var(--surface-hover) 18px);
}
.tree-row:has(>a.active) .tree-menu summary{
  background:linear-gradient(to right, var(--active-fade) 0, var(--active-bg) 18px);
}
.tree-menu-pop{
  position:absolute; right:0; top:100%; z-index:10; min-width:150px;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-sm); padding:4px; display:flex; flex-direction:column;
}
.tree-menu-pop form{margin:0}
.tree-menu-pop a,.tree-menu-pop button{
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:6px 8px; border-radius:4px; color:var(--fg-secondary); font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit;
}
.tree-menu-pop a:hover,.tree-menu-pop button:hover{background:var(--surface-hover); text-decoration:none}
.content{flex:1; padding:32px 40px; max-width:calc(var(--maxw) + 80px); width:100%}
/* "On this page". A third flex column so .content keeps its measure, hidden
   whenever the window is too narrow to afford it. min-width:0 and wrapping text
   are load-bearing: body is a flex row, so an unbreakable line in here would
   raise this column's min-content width and scroll the whole page sideways
   instead of being clipped. */
.toc{
  flex:0 0 232px; min-width:0; align-self:flex-start; position:sticky; top:0;
  max-height:100vh; overflow:auto;
  /* Top padding clears .session-corner, which floats at top:12px and is 34px
     tall — without it the rail's own heading sits under the Help button. */
  padding:60px 24px 32px 0;
}
.toc-head{
  color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.06em;
  text-transform:uppercase; margin-bottom:10px;
}
.toc-list{list-style:none; margin:0; padding:0; border-left:1px solid var(--line)}
.toc-item{margin:0}
.toc-item > a{
  display:block; padding:5px 10px; margin-left:-1px;
  border-left:2px solid transparent; overflow-wrap:anywhere;
  color:var(--muted); font-size:13px; line-height:1.4; text-decoration:none;
}
.toc-item[data-depth="1"] > a{padding-left:22px; font-size:12.5px}
.toc-item[data-depth="2"] > a{padding-left:34px; font-size:12.5px}
.toc-item > a:hover{color:var(--fg); text-decoration:none}
/* data-active marks the section and its parent; data-current only the one the
   reader is in. Both are data- attributes rather than the link's ARIA state,
   because this stylesheet ships on every page and a view with no open page is
   asserted to name nothing as current anywhere in its HTML. */
.toc-item[data-active] > a{color:var(--fg-secondary)}
.toc-item[data-current] > a{color:var(--accent); border-left-color:var(--accent)}
@media (max-width:1180px){.toc{display:none}}
.crumbs{color:var(--muted); font-size:13px; margin-bottom:18px}
.crumbs .sep{color:var(--line); margin:0 2px}
.page-head{display:flex; justify-content:space-between; gap:20px; align-items:flex-start}
.page-head h1{font-size:30px; line-height:1.2; margin:0 0 8px}
.meta{margin:0 0 24px}
.tags{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
.tag{background:var(--surface-hover); color:var(--fg-secondary); font-size:12px; padding:2px 8px; border-radius:999px}
.updated{color:var(--muted); font-size:12px}
.tags + .updated{margin-top:8px}
.actions{display:flex; gap:8px; flex:0 0 auto; align-items:center; flex-wrap:wrap}
.action-form{display:inline-flex; margin:0}
.confirm-actions{display:flex; gap:8px; align-items:center; margin-top:16px}
.session-actions{display:inline-flex; align-items:center; gap:8px; margin:0}
.session-user{color:var(--muted); font-size:13px}
.session-corner{position:fixed; top:12px; right:16px; z-index:50;
  display:flex; align-items:center; gap:8px}
/* The corner's two icon buttons share one box; only the theme toggle swaps its
   glyph, so the rules below it stay on that class alone. */
.theme-toggle,.chat-button,.gallery-button,.dash-button,.instructions-button,.feedback-button,.quit-button{
  display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:34px; height:34px; padding:0; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--fg-secondary); cursor:pointer;
}
.theme-toggle:hover,.chat-button:hover,.gallery-button:hover,.dash-button:hover,.instructions-button:hover,.feedback-button:hover,.quit-button:hover{background:var(--surface-hover-2); color:var(--fg)}
.chat-button svg,.gallery-button svg,.dash-button svg,.instructions-button svg,.feedback-button svg,.quit-button svg{display:block}
.chat-button[aria-expanded="true"]{background:var(--active-bg); border-color:var(--accent); color:var(--accent)}
.theme-toggle .theme-icon{display:block}
.theme-toggle .icon-moon{display:none}
:root[data-theme="dark"] .theme-toggle .icon-sun{display:none}
:root[data-theme="dark"] .theme-toggle .icon-moon{display:block}
.help-dialog{
  width:min(520px,92vw); border:1px solid var(--line); border-radius:10px;
  padding:0; color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.help-dialog::backdrop{background:var(--backdrop)}
/* An opened dialog holds the focus itself (HELP_SCRIPT, GALLERY_SCRIPT), so
   Tab and Esc work at once; the frame needs no ring for it. */
.help-dialog:focus,.gallery-viewer:focus{outline:none}
/* The feedback dialog draws itself in a shadow root (FEEDBACK_SCRIPT); these
   hand it KB25's colours, which follow the theme like everything else. */
:root{
  --feedback-accent:var(--accent); --feedback-on-accent:var(--on-accent); --feedback-fg:var(--fg);
  --feedback-muted:var(--muted); --feedback-surface:var(--surface); --feedback-field:var(--bg);
  --feedback-line:var(--line); --feedback-code:var(--code-bg); --feedback-hover:var(--surface-hover-2);
  --feedback-error:var(--error-fg);
}
/* Bottom-right on every signed-in page, out of the way of the corner tools
   and the page; hidden unless an installed copy has an update to offer. The
   copy-link toast (bottom-center, z-index 60) still shows above it. */
.update-card{
  position:fixed; bottom:16px; right:16px; z-index:50; width:min(320px, calc(100vw - 32px));
  padding:14px 16px; border:1px solid var(--line); border-radius:10px;
  background:var(--surface); color:var(--fg); box-shadow:var(--shadow-lg);
}
.update-title{margin:0; font-size:14px; font-weight:600}
.update-text{margin:6px 0 0; color:var(--muted); font-size:13px; overflow-wrap:anywhere}
.update-notes{display:inline-block; margin-top:4px; font-size:13px}
.update-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:12px}
.help-head{
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  margin:0; padding:16px 20px; border-bottom:1px solid var(--line);
}
.help-head h2{font-size:18px; line-height:1.2; margin:0}
.help-close{
  border:0; background:transparent; cursor:pointer; color:var(--muted);
  font-size:22px; line-height:1; padding:0 4px;
}
.help-close:hover{color:var(--fg)}
.help-section{padding:16px 20px 0}
.help-section:last-child{padding-bottom:20px}
.help-section .quit-error{margin-top:8px; color:var(--error-fg)}
.quit-actions{display:flex; justify-content:flex-end; gap:8px; margin:0; padding:16px 20px 20px}
.help-section h3{font-size:14px; margin:0 0 8px}
.help-section p{margin:0; color:var(--fg-secondary); font-size:14px; line-height:1.6}
.help-keys{display:grid; grid-template-columns:auto 1fr; gap:8px 16px; margin:0}
.help-keys dt{display:flex; align-items:center; gap:4px}
.help-keys dd{margin:0; color:var(--fg-secondary); font-size:14px}
.help-keys kbd{
  display:inline-block; border:1px solid var(--line); border-bottom-width:2px;
  border-radius:5px; background:var(--code-bg); padding:1px 6px;
  font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.button{
  display:inline-flex; align-items:center; justify-content:center; min-height:34px;
  border:1px solid var(--line); border-radius:6px; padding:5px 12px;
  font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  cursor:pointer;
}
.button:hover{text-decoration:none}
.button.primary{background:var(--accent); border-color:var(--accent); color:var(--on-accent)}
.button.secondary{background:var(--surface); color:var(--fg-secondary)}
.button.secondary:hover{background:var(--surface-hover-2)}
.button.danger{background:var(--surface); border-color:var(--error-border); color:var(--error-fg)}
.button.danger:hover{background:var(--error-bg)}
/* Transient feedback after a "Copy link" action: the clicked control tints, and
   the toast below carries the wording. */
.button.copied{background:var(--success-bg); border-color:var(--success-border); color:var(--success-fg)}
.button.copy-failed{background:var(--error-bg); border-color:var(--error-border); color:var(--error-fg)}
.tree-menu-pop button.copied{color:var(--success-fg)}
.tree-menu-pop button.copy-failed{color:var(--error-fg)}
.tree a.copied{background:var(--success-bg); color:var(--success-fg)}
.tree a.copy-failed{background:var(--error-bg); color:var(--error-fg)}
/* Toast: rises from below the bottom edge, holds a couple of seconds, sinks back.
   Created by COPY_LINK_SCRIPT; the class names stay generic so another action can
   reuse it. z-index clears .session-corner (50); a <dialog> still wins via the
   top layer, which is correct — a modal should cover it. */
.toast{
  position:fixed; left:50%; bottom:24px; z-index:60;
  max-width:min(420px,calc(100vw - 32px)); padding:10px 16px;
  border:1px solid var(--success-border); border-radius:8px;
  background:var(--success-bg); color:var(--success-fg);
  font-size:14px; font-weight:600; text-align:center;
  box-shadow:var(--shadow-md); pointer-events:none;
  opacity:0; transform:translate(-50%,calc(100% + 24px));
  transition:transform .28s ease, opacity .28s ease;
}
.toast.is-visible{opacity:1; transform:translate(-50%,0)}
.toast.is-error{border-color:var(--error-border); background:var(--error-bg); color:var(--error-fg)}
@media(prefers-reduced-motion:reduce){
  /* No travel when less motion was asked for — fade in place instead. */
  .toast{transform:translate(-50%,0); transition:opacity .12s ease}
}
.prose{max-width:var(--maxw)}
.prose h1,.prose h2,.prose h3{line-height:1.25; margin-top:1.6em}
.prose h2{font-size:22px; border-bottom:1px solid var(--line); padding-bottom:.2em}
.prose h3{font-size:18px}
/* Section links. Nothing is sticky above the content, so a #anchor already
   lands at the top of the viewport; the margin is breathing room and clears the
   floating .session-corner. The affordance sits after the heading text because
   the left gutter belongs to .note-pin. */
.prose :is(h1,h2,h3,h4,h5,h6){scroll-margin-top:28px}
.section-link{
  margin-left:.4em; color:var(--muted); text-decoration:none; font-weight:400;
  opacity:0; transition:opacity .12s ease; cursor:pointer;
}
/* Generated, so the glyph stays out of the heading's textContent — see the
   heading_close renderer for why that matters. */
.section-link::before{content:"#"}
@media (prefers-reduced-motion:reduce){.section-link{transition:none}}
.prose :is(h1,h2,h3,h4,h5,h6):hover .section-link,
.section-link:focus-visible{opacity:1}
.section-link:hover{color:var(--accent)}
.section-link.copied{opacity:1; color:var(--success-fg)}
.section-link.copy-failed{opacity:1; color:var(--error-fg)}
@media (hover:none){.section-link{opacity:.5}}
.prose p,.prose ul,.prose ol{margin:.7em 0}
.prose code{background:var(--code-bg); padding:.15em .35em; border-radius:4px;
  font-size:.88em; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.prose pre{background:var(--code-bg); padding:14px 16px; border-radius:8px;
  overflow:auto; border:1px solid var(--line)}
.prose pre code{background:none; padding:0}
.prose pre.mermaid{background:none; border:none; padding:0; text-align:center; overflow:auto}
.prose pre.mermaid:not([data-processed]){visibility:hidden}
/* A formula wider than the column scrolls on its own instead of the page. */
.prose .katex-display{overflow-x:auto; overflow-y:hidden; padding:.2em 0}
.prose .math-block{margin:.7em 0}
.prose .math-block .katex-display{margin:0}
.prose blockquote{margin:1em 0; padding:.4em 1em; color:var(--muted);
  border-left:3px solid var(--line)}
.prose table{border-collapse:collapse; width:100%}
.prose th,.prose td{border:1px solid var(--line); padding:6px 10px; text-align:left}
/* height:auto keeps a width-sized image undistorted when max-width shrinks it. */
.prose img{max-width:100%; height:auto}
/* Diagrams are usually drawn in black on a transparent background meant for a
   white page, so in dark mode their lines and labels vanish into --bg. Back
   every image with a light panel there, dimmed slightly to cut the glare. */
:root[data-theme="dark"] .prose img{background:#f0f3f6; padding:8px; border-radius:6px; filter:brightness(.9)}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]) .prose img{background:#f0f3f6; padding:8px; border-radius:6px; filter:brightness(.9)}
}
.wikilink{border-bottom:1px dotted var(--accent)}
/* Inline notes.
   Only annotated blocks become positioning contexts, so an unannotated page
   lays out exactly as it did before this feature existed. The pin sits in the
   left padding of .content (40px, 20px on mobile) — hence the two offsets. */
.prose [data-kb25-notes]{position:relative}
/* A task, a highlight and an agent note each carry their own palette on the
   element, so every rule below stays kind-agnostic and a remark keeps the teal it
   always had. Leaf elements only: swapping the tokens on a container would leak
   into the Remark button of the kind switch nested inside a card. An agent note
   has no .note-kind-option, because the switch never offers it. */
.note-mark.is-task,.note-pin.is-task,.note-kind.is-task,.note-kind-option.is-task{
  --note-bg:var(--task-bg); --note-bg-strong:var(--task-bg-strong);
  --note-fg:var(--task-fg); --note-pin:var(--task-pin); --note-border:var(--task-border);
}
.note-mark.is-highlight,.note-pin.is-highlight,.note-kind.is-highlight,
.note-kind-option.is-highlight{
  --note-bg:var(--highlight-bg); --note-bg-strong:var(--highlight-bg-strong);
  --note-fg:var(--highlight-fg); --note-pin:var(--highlight-pin);
  --note-border:var(--highlight-border);
}
.note-mark.is-agent,.note-pin.is-agent,.note-kind.is-agent{
  --note-bg:var(--agent-bg); --note-bg-strong:var(--agent-bg-strong);
  --note-fg:var(--agent-fg); --note-pin:var(--agent-pin); --note-border:var(--agent-border);
}
.prose mark.note-mark{
  background:var(--note-bg); color:var(--note-fg);
  border-radius:2px; padding:0 .05em; cursor:pointer;
}
.prose mark.note-mark.is-active{background:var(--note-bg-strong)}
.prose mark.note-mark.is-highlight{
  background:transparent; color:inherit; border-radius:0; padding:0;
  text-decoration-line:underline; text-decoration-color:var(--note-pin);
  text-decoration-thickness:.14em; text-underline-offset:.12em;
}
.prose mark.note-mark.is-highlight.is-active{
  background:transparent; text-decoration-thickness:.22em;
}
.note-pin{
  position:absolute; left:-22px; top:.3em; width:14px; height:14px; padding:0;
  border:2px solid var(--note-pin); border-radius:50%; background:var(--note-pin);
  cursor:pointer; line-height:0;
}
.note-pin.is-remark{background:transparent}
.note-pin:hover{box-shadow:0 0 0 3px var(--note-bg)}
.note-popover,.note-composer{
  position:fixed; z-index:70; width:min(320px,calc(100vw - 24px));
  padding:12px 14px; border:1px solid var(--note-border); border-radius:8px;
  background:var(--surface); color:var(--fg); box-shadow:var(--shadow-lg);
  display:flex; flex-direction:column; gap:10px;
}
.note-card{display:flex; flex-direction:column; gap:6px}
.note-card + .note-card{border-top:1px solid var(--line); padding-top:10px}
.note-card-head{display:flex; align-items:center; gap:8px}
.note-kind{
  font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
  padding:1px 7px; border-radius:999px;
  background:var(--note-bg); color:var(--note-fg); border:1px solid var(--note-border);
}
.note-kind.is-remark{background:var(--surface-hover); color:var(--muted); border-color:var(--line)}
.note-when{color:var(--muted); font-size:12px}
.note-quote{
  color:var(--muted); font-size:13px; font-style:italic;
  border-left:2px solid var(--note-border); padding-left:8px;
}
/* pre-wrap so a multi-line note keeps the shape its author gave it. */
.note-text{font-size:14px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere}
/* A link in a note is underlined the way a [[wiki-link]] is in the prose: in a
   card this small, colour alone is thin evidence that a phrase is clickable. */
.note-text a{border-bottom:1px dotted var(--accent)}
.note-input{
  width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:6px;
  background:var(--bg); color:var(--fg); font:inherit; font-size:14px; resize:vertical;
}
.note-composer-actions,.note-card-actions{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
/* Three kinds alongside Cancel and Save do not fit across a 320px panel, and a
   clipped third kind is one nobody finds — so the switch takes the full width of
   its own row and splits it evenly. Reading a note shows no switch, so the
   Edit/Resolve row below is unaffected. */
.note-kinds{display:flex; flex:1 0 100%; border:1px solid var(--line); border-radius:6px; overflow:hidden}
.note-kind-option{
  flex:1; padding:4px 8px; text-align:center;
  border:0; background:var(--surface); color:var(--muted);
  font:inherit; font-size:13px; cursor:pointer;
}
.note-kind-option.is-selected{background:var(--note-bg); color:var(--note-fg); font-weight:600}
.note-add{
  position:fixed; z-index:70; padding:5px 12px;
  border:1px solid var(--note-border); border-radius:999px;
  background:var(--note-pin); color:#fff;
  font:inherit; font-size:13px; font-weight:600; cursor:pointer;
  box-shadow:var(--shadow-md);
}
/* Diff / history viewer */
.button.disabled{color:var(--muted); background:var(--surface); cursor:default; opacity:.55}
.button.disabled:hover{background:var(--surface)}
.diff-title{font-weight:400; color:var(--muted)}
.revbar{
  display:flex; flex-wrap:wrap; align-items:center; gap:12px; justify-content:space-between;
  padding:10px 14px; margin:0 0 16px; border:1px solid var(--line); border-radius:8px;
  background:var(--sidebar);
}
.revbar-meta{display:flex; flex-wrap:wrap; align-items:center; gap:10px; min-width:0}
.revbar-nav{display:flex; gap:8px; flex:0 0 auto}
.diff-pos{font-weight:700}
.diff-date{color:var(--muted); font-variant-numeric:tabular-nums}
.diff-subject{
  color:var(--muted); font-size:13px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.badge{
  display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:700;
  border:1px solid transparent;
}
.badge-web{color:var(--badge-web-fg); background:var(--badge-web-bg); border-color:var(--badge-web-border)}
.badge-mcp{color:var(--badge-mcp-fg); background:var(--badge-mcp-bg); border-color:var(--badge-mcp-border)}
.diffview{
  max-width:var(--maxw); white-space:pre-wrap; word-wrap:break-word;
  background:var(--code-bg); border:1px solid var(--line); border-radius:8px;
  padding:14px 16px; overflow:auto;
  font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.diffview ins.diff-add{
  text-decoration:none; color:var(--diff-add-fg); background:var(--diff-add-bg);
  border-radius:3px; padding:0 1px;
}
.diffview del.diff-del{
  text-decoration:line-through; color:var(--diff-del-fg); background:var(--diff-del-bg);
  border-radius:3px; padding:0 1px;
}
.diff-sep{display:block; color:var(--muted); text-align:center; user-select:none; margin:.4em 0}
.editor-content{max-width:none}
.editor{max-width:1100px}
.editor-label{display:block; font-size:13px; font-weight:700; margin-bottom:8px}
.editor textarea{
  display:block; width:100%; min-height:62vh; resize:vertical;
  border:1px solid var(--line); border-radius:8px; padding:14px 16px;
  color:var(--fg); background:var(--surface);
  font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.editor textarea:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.slug-row{display:flex; align-items:center; gap:6px; margin-bottom:6px}
.slug-prefix{color:var(--muted); font:13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.slug-row input{
  flex:1; border:1px solid var(--line); border-radius:8px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.slug-row input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.slug-hint{color:var(--muted); font-size:12px; margin:0 0 16px}
.form-actions{display:flex; gap:8px; align-items:center; margin-top:12px}
.notice{
  max-width:1100px; margin:0 0 16px; border:1px solid var(--line);
  border-radius:8px; padding:10px 12px; font-size:14px;
}
.notice.error{border-color:var(--error-border); background:var(--error-bg); color:var(--error-fg)}
.notice.success{border-color:var(--success-border); background:var(--success-bg); color:var(--success-fg)}
.notice.warning,.notice.archived{border-color:var(--warning-border); background:var(--warning-bg); color:var(--warning-fg)}
.path-label{color:var(--muted); font-size:12px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.login-page{
  min-height:100vh; align-items:center; justify-content:center; padding:24px;
  background:var(--sidebar);
}
.login-panel{
  width:100%; max-width:360px; border:1px solid var(--line); border-radius:8px;
  background:var(--surface); padding:24px;
}
.login-panel h1{font-size:24px; line-height:1.2; margin:0 0 4px}
.login-subtitle{color:var(--muted); margin:0 0 20px}
.login-form{display:grid; gap:8px}
.login-form label{font-size:13px; font-weight:700}
.login-form input{
  width:100%; border:1px solid var(--line); border-radius:6px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.login-form input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.login-form button{margin-top:8px}
.login-panel .notice{max-width:none; margin-bottom:16px}
/* The update gate (updateGateLayout). */
.gate-page{
  min-height:100vh; align-items:center; justify-content:center; padding:24px;
  background:var(--sidebar);
}
.gate-panel{
  width:100%; max-width:440px; border:1px solid var(--line); border-radius:10px;
  background:var(--surface); padding:28px; display:flex; flex-direction:column; gap:12px;
}
.gate-icon{display:block; width:48px; height:48px; border-radius:11px}
.gate-panel h1{font-size:22px; line-height:1.25; margin:4px 0 0}
.gate-text{margin:0; color:var(--fg-secondary); font-size:15px; line-height:1.55; overflow-wrap:anywhere}
.gate-notes{align-self:flex-start; font-size:14px}
.gate-progress{position:relative; height:4px; margin:6px 0; border-radius:2px; background:var(--line); overflow:hidden}
.gate-progress::after{
  content:""; position:absolute; top:0; bottom:0; left:0; width:35%; border-radius:2px;
  background:var(--accent); animation:gate-slide 1.4s ease-in-out infinite;
}
@keyframes gate-slide{from{transform:translateX(-100%)} to{transform:translateX(290%)}}
@media (prefers-reduced-motion:reduce){.gate-progress::after{animation:none; width:100%; opacity:.6}}
.gate-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:8px}
.gate-actions[hidden]{display:none}
/* compact highlight.js theme (github-ish) */
.hljs-comment,.hljs-quote{color:var(--hl-comment)}
.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:var(--hl-keyword)}
.hljs-string,.hljs-doctag,.hljs-regexp{color:var(--hl-string)}
.hljs-number,.hljs-built_in{color:var(--hl-number)}
.hljs-title,.hljs-section,.hljs-name{color:var(--hl-title)}
.hljs-attr,.hljs-attribute,.hljs-variable{color:var(--hl-attr)}
/* space switcher in the sidebar */
.space-switcher{margin:0 0 16px}
.space-current{display:block; font-weight:700; font-size:15px; color:var(--fg)}
.space-all{display:block; color:var(--muted); font-size:12px; margin-top:2px}
/* spaces landing page */
.spaces-page{display:block; background:var(--sidebar)}
.spaces-main{max-width:920px; margin:0 auto; padding:40px 24px}
.spaces-head{display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:28px}
.spaces-head h1{font-size:28px; line-height:1.2; margin:0}
.spaces-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px}
.space-card-wrap{position:relative; display:flex}
.space-card{
  flex:1; display:flex; flex-direction:column; gap:6px; padding:18px 18px 20px;
  border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--fg);
}
.space-card:hover{text-decoration:none; border-color:var(--focus-ring); box-shadow:var(--shadow-card)}
.space-icon{font-size:26px; line-height:1}
.space-card-title{font-weight:700; font-size:16px}
.space-summary{margin:0; color:var(--muted); font-size:13px; line-height:1.5}
.spaces-grid .empty{color:var(--muted)}
/* Per-space ⋯ menu, floated into the card's top-right corner. */
.space-menu{position:absolute; top:10px; right:10px}
.space-menu>summary{
  list-style:none; cursor:pointer; user-select:none;
  display:flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:6px; opacity:0; transition:opacity .1s ease;
  border:1px solid var(--line); background:var(--surface); color:var(--muted); font-size:16px; line-height:1;
}
.space-menu>summary::-webkit-details-marker{display:none}
.space-menu>summary::marker{content:""}
.space-card-wrap:hover .space-menu>summary,.space-menu[open]>summary{opacity:1}
.space-menu>summary:hover{background:var(--surface-hover-2); color:var(--fg)}
.space-menu-pop{
  position:absolute; right:0; top:32px; z-index:10; min-width:190px;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-md); padding:6px; display:flex; flex-direction:column; gap:4px;
}
.space-menu-pop form{margin:0}
.space-menu-pop>form:not(.menu-name-form)>button,.space-menu-pop>a{
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:6px 8px; border-radius:4px; color:var(--fg-secondary); font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit;
}
.space-menu-pop>form:not(.menu-name-form)>button:hover,.space-menu-pop>a:hover{
  background:var(--surface-hover); text-decoration:none;
}
.space-menu-pop>a{color:var(--error-fg)}
.space-menu-pop .menu-name-form{flex-direction:row; align-items:center; gap:4px}
.space-menu-pop .menu-name-form input[type=text]{flex:1; min-width:0}
.space-menu-pop .menu-name-form button{
  flex:0 0 auto; border:1px solid var(--line); border-radius:4px; background:var(--surface);
  padding:5px 8px; color:var(--fg-secondary); font-size:12px; font-weight:600; cursor:pointer; font-family:inherit;
}
.space-menu-pop .menu-name-form button:hover{background:var(--surface-hover-2)}
.space-confirm .confirm-actions{margin-top:12px}
/* The Archive button sits down here, beside New Space, rather than in the
   header, whose top-right corner .session-corner floats over (feedback #24). */
.spaces-foot{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:28px}
.new-space-form{display:flex; flex:1 1 auto; gap:8px}
.new-space-form input{
  flex:1; max-width:360px; border:1px solid var(--line); border-radius:6px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.new-space-form input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
/* Tasks dashboard (and the shared dashboard pieces: lede, stat cards).
   Rides the note palettes already defined for pins and marks — a task is purple
   here for the same reason it is purple on the page it was left on. */
.dash-lede{margin:0 0 20px; color:var(--fg-secondary); font-size:14px}
.stat-row{display:flex; flex-wrap:wrap; gap:12px; margin-bottom:28px}
.stat-card{
  display:flex; flex-direction:column; gap:2px; min-width:96px;
  padding:12px 16px; border:1px solid var(--line); border-radius:8px;
  background:var(--surface);
}
.stat-value{font-size:24px; font-weight:600; line-height:1.1; color:var(--fg)}
.stat-label{font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em}
.task-group{margin-bottom:24px}
.task-group-head{
  display:flex; align-items:baseline; gap:8px; margin:0 0 2px;
  font-size:15px; font-weight:600; border:none; padding:0;
}
.task-group-head a{color:var(--fg)}
/* Clipped to one line by height rather than by white-space:nowrap. Nowrap text
   raises the min-content width of everything around it, and .content is a flex
   item sized by its automatic minimum — one long trail widened the whole page. */
.task-crumb{
  margin:0 0 8px; max-height:1.4em; overflow:hidden;
  color:var(--muted); font-size:12px; line-height:1.4;
}
.task-count{
  flex:0 0 auto; padding:1px 8px; border-radius:10px;
  background:var(--task-bg); color:var(--task-fg); font-size:12px; font-weight:600;
}
.task-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px}
/* The row is the positioning context for the copy button pinned inside its
   top-right corner; .task-link reserves that corner in its own padding so no
   line of note text ever runs under it. */
.task-item{position:relative}
.task-link{
  display:flex; flex-direction:column; gap:3px;
  padding:10px 104px 10px 14px; border:1px solid var(--line); border-radius:6px;
  border-left:3px solid var(--task-pin); background:var(--surface); color:var(--fg);
}
.task-link:hover{background:var(--surface-hover); text-decoration:none}
/* The note's own handle. The id is shown, not just copied, so a reference pasted
   into a chat can be matched back to the row it came from; what lands on the
   clipboard is that id qualified with its page (space/…/page#id). Quiet until
   pointed at — it sits on every row, and a column of loud chips would compete
   with the notes themselves. */
.task-copy{
  position:absolute; top:9px; right:9px;
  display:inline-flex; align-items:center; gap:5px;
  padding:2px 7px; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--muted); cursor:pointer;
  font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.task-copy:hover{background:var(--surface-hover-2); border-color:var(--task-border); color:var(--fg)}
.task-copy:focus-visible{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.task-copy.copied{background:var(--success-bg); border-color:var(--success-border); color:var(--success-fg)}
.task-copy.copy-failed{background:var(--error-bg); border-color:var(--error-border); color:var(--error-fg)}
.task-quote{
  color:var(--task-fg); background:var(--task-bg); border-radius:2px;
  align-self:flex-start; padding:0 4px; font-size:13px;
}
.task-text{font-size:14px; line-height:1.45; white-space:pre-wrap}
.task-text.is-empty{color:var(--muted); font-style:italic}
.task-by{color:var(--muted); font-size:12px}
.dash-empty{color:var(--fg-secondary)}
.dash-back{display:inline-block; margin:0 0 12px; font-size:14px}
/* Dashboards hub: one card per report. */
.hub-grid{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px;
}
.hub-card{
  display:flex; flex-direction:column; gap:6px; height:100%;
  padding:16px 18px; border:1px solid var(--line); border-radius:8px;
  background:var(--surface); color:var(--fg);
}
.hub-card:hover{background:var(--surface-hover); text-decoration:none}
.hub-card:focus-visible{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.hub-title{font-size:16px; font-weight:600; color:var(--accent)}
.hub-stat{display:flex; align-items:baseline; gap:6px}
.hub-desc{font-size:13px; color:var(--fg-secondary); line-height:1.45}
/* Gallery. Each thumbnail box is square before its image loads, so a grid of
   lazy images never shifts the page as they arrive. */
.gallery-bar{display:flex; align-items:flex-start; justify-content:space-between; gap:20px; flex-wrap:wrap}
.gallery-bar .dash-lede{flex:1 1 320px; margin-bottom:12px}
.gallery-upload{flex:0 0 auto; margin:0}
.gallery-upload label{position:relative; cursor:pointer}
/* Out of sight but still focusable; the label is what is seen. */
.gallery-upload input[type="file"]{position:absolute; width:1px; height:1px; opacity:0; overflow:hidden}
.gallery-upload label:focus-within{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.gallery-upload.is-busy label{opacity:.7; pointer-events:none}
.gallery-count{margin:0 0 10px; color:var(--muted); font-size:13px}
.prose .gallery-grid{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); gap:14px;
}
.gallery-item{display:flex; flex-direction:column; gap:4px; min-width:0}
.gallery-thumb{
  display:block; aspect-ratio:1; overflow:hidden;
  border:1px solid var(--line); border-radius:8px; background:var(--code-bg);
}
.gallery-thumb:hover{border-color:var(--accent)}
.gallery-thumb:focus-visible{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.gallery-item.is-new .gallery-thumb{border-color:var(--accent); box-shadow:0 0 0 2px var(--focus-ring-soft)}
.prose .gallery-thumb img{display:block; width:100%; height:100%; max-width:none; object-fit:contain; box-sizing:border-box}
/* Clipped by overflow rather than nowrap, which would widen the whole page
   (see .task-crumb). One click selects the whole reference, ready to paste. */
.prose .gallery-ref{
  display:block; max-height:1.5em; overflow:hidden; overflow-wrap:anywhere;
  padding:0; background:none; color:var(--fg-secondary); font-size:12px; user-select:all;
}
.gallery-size{color:var(--muted); font-size:12px}
.gallery-viewer{
  width:min(1100px,94vw); max-height:94vh; border:1px solid var(--line); border-radius:10px;
  padding:0; color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.gallery-viewer::backdrop{background:var(--backdrop)}
/* It sits inside .prose, whose h2 is underlined like a page's section. */
.gallery-viewer .help-head h2{font-size:15px; margin:0; padding:0; border:0; overflow-wrap:anywhere}
.gallery-viewer-frame{display:flex; justify-content:center; padding:16px 20px 0}
.prose .gallery-viewer-frame img{max-width:100%; max-height:72vh; object-fit:contain}
.gallery-viewer-meta{margin:0; padding:12px 20px 16px; color:var(--muted); font-size:13px; overflow-wrap:anywhere}
/* Labels. A chip or dot reads its colours from --lc-*, which default to grey
   and are repointed by the data-label-color rule that follows. Chips wrap
   rather than nowrap: nowrap text inside .content widens the whole page. */
.label-chip,.label-dot{
  --lc-bg:var(--label-gray-bg); --lc-fg:var(--label-gray-fg); --lc-dot:var(--label-gray-dot);
}
${LABEL_COLOR_RULES}
.label-chips{display:inline-flex; flex-wrap:wrap; gap:4px; min-width:0}
.label-chip{
  display:inline-block; max-width:100%; padding:1px 8px; border-radius:999px;
  border:1px solid transparent; background:var(--lc-bg); color:var(--lc-fg);
  font-size:12px; font-weight:600; line-height:1.5; overflow-wrap:anywhere;
}
a.label-chip:hover{text-decoration:none; border-color:var(--lc-dot)}
.label-chip.is-orphan{border:1px dashed var(--lc-dot)}
.label-dot{
  display:inline-block; width:8px; height:8px; border-radius:50%;
  background:var(--lc-dot); flex:0 0 auto;
}
.page-labels{margin-bottom:8px}
.sr-only{
  position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); border:0;
}
/* The label dialog borrows the Help dialog's head and close button. */
.label-dialog,.folder-dialog{
  width:min(440px,92vw); border:1px solid var(--line); border-radius:10px;
  padding:0; color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.label-dialog::backdrop,.folder-dialog::backdrop{background:var(--backdrop)}
.folder-dialog{width:min(400px,92vw)}
.folder-dialog-body{display:flex; flex-direction:column; gap:6px; padding:16px 20px 18px}
.folder-dialog-label{font-size:13px; font-weight:600; color:var(--fg-secondary)}
.folder-dialog-input{
  width:100%; border:1px solid var(--line); border-radius:6px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.folder-dialog-input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.folder-dialog-input[aria-invalid="true"]{border-color:var(--error-fg)}
.folder-dialog-hint{margin:0; color:var(--muted); font-size:12px; line-height:1.45; overflow-wrap:anywhere}
.folder-dialog-error{margin:0; color:var(--error-fg); font-size:12px; line-height:1.45}
.button:disabled{opacity:.5; cursor:not-allowed}
.label-dialog-form{margin:0}
.label-dialog-body{
  display:flex; flex-direction:column; gap:14px;
  padding:14px 20px; max-height:60vh; overflow:auto;
}
.label-dialog-page{margin:0; color:var(--fg-secondary); font-size:14px; font-weight:600; overflow-wrap:anywhere}
.label-dialog fieldset{border:0; margin:0; padding:0; min-width:0}
.label-dialog legend{
  padding:0; margin:0 0 6px; color:var(--muted);
  font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
}
.label-option{
  display:flex; align-items:center; gap:8px; min-width:0;
  padding:4px 6px; border-radius:6px; cursor:pointer;
}
.label-option:hover{background:var(--surface-hover-2)}
.label-option input{margin:0; flex:0 0 auto}
.label-dialog-empty{margin:0; color:var(--fg-secondary); font-size:13px}
.label-dialog-new input[type="text"]{
  width:100%; border:1px solid var(--line); border-radius:6px; padding:7px 10px;
  color:var(--fg); background:var(--surface);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.label-dialog-new input[type="text"]:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.label-swatches{display:flex; flex-wrap:wrap; gap:8px; margin-top:10px}
.label-swatch{position:relative; display:inline-flex; cursor:pointer}
.label-swatch input{position:absolute; inset:0; margin:0; opacity:0; cursor:pointer}
.label-swatch .label-dot{width:20px; height:20px; box-shadow:0 0 0 1px var(--line)}
.label-swatch input:checked + .label-dot{box-shadow:0 0 0 2px var(--surface), 0 0 0 4px var(--fg)}
.label-swatch input:focus-visible + .label-dot{outline:2px solid var(--focus-ring); outline-offset:4px}
.label-dialog-actions{
  display:flex; align-items:center; justify-content:flex-end; gap:8px;
  padding:12px 20px; border-top:1px solid var(--line);
}
.label-dialog-manage{margin-right:auto; font-size:13px}
/* A page nobody has opened since it appeared: an accent dot with a steady
   glow, no pulse, so it marks the row without pulling at the eye while reading. */
.tree-fresh,.tree-fresh-within{
  flex:0 0 auto; width:8px; height:8px; margin:0 8px 0 6px; border-radius:50%;
}
.tree-fresh{background:var(--accent); box-shadow:0 0 6px 1px var(--fresh-glow)}
/* A shut group hiding such a page: a hollow ring, quieter than the dot, so it
   reads as "in here" rather than "this one". Gone once the group is open and
   the dot itself is on screen. */
.tree-fresh-within{display:none; border:1.5px solid var(--accent)}
.tree li.collapsed > .tree-row > .tree-fresh-within{display:block}
.label-filter{display:flex; flex-direction:column; gap:12px; margin:0 0 24px}
/* A fieldset's default min-width is its min-content, which a long row of chips
   would push past the viewport. */
.label-filter-chips{display:flex; flex-wrap:wrap; gap:8px; border:none; margin:0; padding:0; min-width:0}
.label-filter-legend{
  float:left; width:100%; margin:0 0 4px; padding:0;
  font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;
}
.label-toggle{
  display:inline-flex; align-items:center; gap:6px; max-width:100%;
  padding:4px 10px 4px 8px; border:1px solid var(--line); border-radius:999px;
  background:var(--surface); cursor:pointer; font-size:13px;
}
.label-toggle:hover{background:var(--surface-hover-2)}
.label-toggle:has(input:checked){border-color:var(--accent); background:var(--active-bg)}
.label-toggle:has(input:focus-visible){outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.label-toggle input{margin:0}
.label-count{color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums}
.label-search{display:flex; flex-wrap:wrap; align-items:center; gap:8px}
.label-search input[type="search"]{
  flex:1 1 220px; min-width:0; max-width:420px;
  border:1px solid var(--line); border-radius:6px; padding:7px 10px;
  color:var(--fg); background:var(--surface);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.label-search input[type="search"]:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.label-clear{font-size:14px}
.label-results-count{margin:0 0 8px; color:var(--muted); font-size:13px}
.label-results{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px}
.label-result{
  display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0;
  padding:10px 14px; border:1px solid var(--line); border-radius:6px; background:var(--surface);
}
.label-result-title{font-size:15px; font-weight:600; overflow-wrap:anywhere}
.label-result .task-crumb{margin:0}
.label-result-text{margin:0; color:var(--fg-secondary); font-size:13px; line-height:1.45; overflow-wrap:anywhere}
.label-manage{margin-top:40px; padding-top:20px; border-top:1px solid var(--line)}
.label-manage h2{margin:0 0 6px; font-size:18px; border:none; padding:0}
.label-manage .dash-lede{margin-bottom:14px}
.label-manage-list{list-style:none; margin:16px 0 0; padding:0; display:flex; flex-direction:column; gap:8px}
.label-manage-row{
  display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px;
  padding:10px 12px; border:1px solid var(--line); border-radius:6px; background:var(--surface);
}
.label-manage-form{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin:0; min-width:0}
.label-manage-form input[type="text"]{
  flex:0 1 200px; min-width:0; border:1px solid var(--line); border-radius:6px; padding:6px 10px;
  color:var(--fg); background:var(--surface);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.label-manage-form input[type="text"]:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.label-manage-row > .label-manage-form{flex:1 1 auto}
.label-manage-form .label-swatches{margin-top:0}
.label-delete{margin-left:auto}
/* Open, the confirmation takes a line of its own instead of squeezing the form. */
.label-delete[open]{flex-basis:100%; margin-left:0}
.label-delete summary{list-style:none}
.label-delete summary::-webkit-details-marker{display:none}
.label-delete[open] summary{margin-bottom:8px}
.label-delete form{margin:0; max-width:360px}
.label-delete p{margin:0 0 8px; color:var(--fg-secondary); font-size:13px; line-height:1.45}
@media(max-width:780px){
  body{flex-direction:column}
  .sidebar{width:auto; flex:none; height:auto; position:static; border-right:none;
    border-bottom:1px solid var(--line)}
  /* iOS Safari zooms the viewport when focusing an input under 16px. */
  .sidebar-search-input{font-size:16px}
  .content{padding:20px}
  .page-head{display:block}
  .actions{margin-bottom:16px}
  /* Too little width to spend 90px of it on an id that is about to be copied
     anyway: the glyph alone keeps the button, and the tooltip keeps the id. */
  .task-copy .task-id{display:none}
  .task-link{padding-right:44px}
  /* Less left padding to hang the pin in, so it tucks in closer. */
  .note-pin{left:-17px; width:11px; height:11px}
}

/* --- space instructions editor -------------------------------------------- */
.instructions-hint{
  margin:0 0 18px; padding:14px 16px;
  border:1px solid var(--line); border-radius:10px;
  background:var(--surface); max-width:70ch;
}
.instructions-hint p{margin:0 0 8px; font-size:0.9rem; line-height:1.5}
.instructions-hint p:last-child{margin-bottom:0}
.instructions-meta{color:var(--muted)}
.instructions-count{
  font-variant-numeric:tabular-nums; color:var(--muted);
  font-size:0.85rem !important;
}
.instructions-count.over{color:var(--error-fg); font-weight:600}
/* The chat drawer: a column down the right edge. On a wide window the page
   makes room for it (body is a flex row, so its padding narrows the content)
   and the corner tools and update card move left with it; on a narrow one it
   covers the page, which its own close button gives back. */
.chat-drawer{
  position:fixed; top:0; right:0; bottom:0; z-index:55; width:400px; max-width:100vw;
  display:flex; flex-direction:column; background:var(--surface); color:var(--fg);
  border-left:1px solid var(--line); box-shadow:var(--shadow-md);
}
.chat-drawer[hidden]{display:none}
/* Its parts toggle with the hidden attribute, which loses to any display rule
   (.button's, say) without this. */
.chat-drawer [hidden]{display:none}
body.chat-open{padding-right:400px}
body.chat-open .session-corner,body.chat-open .update-card{right:416px}
/* The page loses the drawer's width, so the "On this page" rail needs that
   much more window to fit beside it (its own cutoff is 1180px). */
@media (max-width:1580px){body.chat-open .toc{display:none}}
@media (max-width:900px){
  body.chat-open{padding-right:0}
  body.chat-open .session-corner,body.chat-open .update-card{right:16px}
  .chat-drawer{width:100vw; border-left:0}
}
.chat-head{display:flex; align-items:center; gap:2px; padding:10px 10px 10px 16px; border-bottom:1px solid var(--line)}
.chat-title{flex:1; min-width:0; margin:0; font-size:14px; font-weight:600; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chat-icon-button{
  display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:30px; height:30px; padding:0; border:0; border-radius:6px;
  background:transparent; color:var(--muted); font-size:18px; line-height:1; cursor:pointer;
}
.chat-icon-button:hover{background:var(--surface-hover); color:var(--fg)}
.chat-icon-button svg{display:block}
.chat-log{flex:1; min-height:0; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:12px}
.chat-msg{font-size:14px; line-height:1.55; overflow-wrap:anywhere}
.chat-user{align-self:flex-end; max-width:85%; padding:8px 12px; border-radius:12px; background:var(--active-bg)}
.chat-user-text{white-space:pre-wrap}
.chat-tag{display:block; margin-bottom:2px; color:var(--accent); font-size:11px; font-weight:700; letter-spacing:.02em}
.chat-assistant > :first-child{margin-top:0}
.chat-assistant > :last-child{margin-bottom:0}
.chat-assistant pre{font-size:12.5px}
.chat-streaming{white-space:pre-wrap}
.chat-report{padding:10px 12px; border:1px solid var(--success-border); border-radius:10px; background:var(--success-bg)}
.chat-report-head{margin-bottom:6px; color:var(--success-fg); font-weight:600}
.chat-report-list{display:grid; gap:6px; margin:0; padding:0; list-style:none}
.chat-report-verb{color:var(--fg-secondary)}
.chat-report-slug{display:block; color:var(--muted); font-size:12px}
.chat-report-gone{color:var(--muted); text-decoration:line-through}
.chat-error{padding:8px 12px; border:1px solid var(--error-border); border-radius:8px; background:var(--error-bg); color:var(--error-fg); white-space:pre-wrap}
.chat-empty{margin:auto 0; padding:0 12px; color:var(--muted); font-size:14px; line-height:1.6; text-align:center}
.chat-activity{padding:6px 16px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chat-form{display:grid; gap:8px; padding:12px; border-top:1px solid var(--line)}
.chat-input{
  width:100%; min-height:40px; max-height:200px; resize:none; padding:8px 10px;
  border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.chat-input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.chat-drawer[data-pages] .chat-input{border-color:var(--accent)}
.chat-form-row{display:flex; align-items:center; gap:8px}
.chat-pages{flex:1; display:inline-flex; align-items:center; gap:6px; color:var(--fg-secondary); font-size:13px; cursor:pointer; user-select:none}
.chat-engines{display:inline-flex; flex:0 0 auto; border:1px solid var(--line); border-radius:6px; overflow:hidden}
.chat-engines button{
  padding:5px 9px; border:0; background:transparent; color:var(--muted); cursor:pointer;
  font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.chat-engines button + button{border-left:1px solid var(--line)}
.chat-engines button[aria-checked="true"]{background:var(--active-bg); color:var(--accent)}
.chat-run{flex-wrap:wrap; gap:6px}
.chat-select{
  flex:0 1 auto; min-width:0; max-width:100%; padding:4px 6px; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--fg-secondary); cursor:pointer;
  font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.chat-select:focus-visible{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.chat-select:disabled{color:var(--muted); cursor:default}
.chat-engine{flex:0 0 auto; padding:1px 8px; border:1px solid var(--line); border-radius:999px; color:var(--muted); font-size:11px; font-weight:600; line-height:1.6}
.chat-drawer[data-pages] .chat-pages{color:var(--accent); font-weight:600}
.chat-history{position:absolute; top:51px; left:0; right:0; bottom:0; z-index:1; overflow:auto; padding:8px; background:var(--surface)}
.chat-history-row{display:flex; align-items:center; gap:4px}
.chat-history-open{
  flex:1; min-width:0; display:grid; gap:2px; padding:8px 10px; border:0; border-radius:6px;
  background:transparent; color:var(--fg); text-align:left; font:inherit; cursor:pointer;
}
.chat-history-open:hover{background:var(--surface-hover)}
.chat-history-title{font-size:14px; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chat-history-when{color:var(--muted); font-size:12px; line-height:1.4}
.chat-setup{display:grid; gap:12px; align-content:start; justify-items:start; padding:16px; color:var(--fg-secondary); font-size:14px; line-height:1.6}
.chat-setup p{margin:0}
.chat-setup code{padding:1px 5px; border-radius:4px; background:var(--code-bg); font-size:13px; overflow-wrap:anywhere}
`;
