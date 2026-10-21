import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configureViews,
  dashboardLayout,
  dashboardsLayout,
  editLayout,
  labelsDashboardLayout,
  labelsHref,
  layout,
  folderLayout,
  loginLayout,
  spacesLayout,
  type DashboardView,
  type DashboardsView,
  type EditView,
  type LabelsDashboardView,
  type PageView,
  type FolderView,
  type LoginView,
  type SpacesView,
} from "./views.js";
import type { PageNode } from "./content.js";
import type { IndexedNote } from "./note-index.js";
import type { Section } from "./markdown.js";

/** A leaf-page tree node fixture (fills in the required flags). */
function node(overrides: Partial<PageNode> & Pick<PageNode, "slug" | "title">): PageNode {
  return {
    fsPath: `/kb/${overrides.slug}.md`,
    isSection: false,
    isFolder: false,
    archived: false,
    children: [],
    ...overrides,
  };
}

function pageView(overrides: Partial<PageView> = {}): PageView {
  return {
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    spaceKey: "kb25",
    tree: [],
    activeSlug: "kb25/notes",
    titles: new Map([["kb25/notes", "Notes"]]),
    title: "Notes",
    contentHtml: "<p>hi</p>",
    username: "alice",
    ...overrides,
  };
}

/** The headings the rail is built from, in document order. */
function sections(overrides: Section[] = []): Section[] {
  return overrides.length
    ? overrides
    : [
        { level: 2, text: "First", anchor: "first", line: 0 },
        { level: 3, text: "Detail", anchor: "detail", line: 4 },
        { level: 2, text: "Second", anchor: "second", line: 8 },
      ];
}

/** A task note as the dashboard receives it, already paired with its page. */
function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "aaa11111",
    kind: "task",
    at: "2026-08-17T10:00:00Z",
    by: "elmir",
    quote: "the workers",
    text: "restart them",
    line: 4,
    page: { slug: "kb25/deploy", title: "Deploy", fsPath: "/kb/kb25/deploy.md" },
    ...overrides,
  };
}

function dashboardView(overrides: Partial<DashboardView> = {}): DashboardView {
  return {
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    spaceKey: "kb25",
    tree: [],
    titles: new Map([["kb25", "KB25"]]),
    spaceTitle: "KB25",
    groups: [
      {
        slug: "kb25/deploy",
        title: "Deploy",
        notes: [note(), note({ id: "bbb22222", line: 20, text: "and the queue" })],
      },
    ],
    summary: {
      total: 2,
      pages: 2,
      oldestAt: "2026-08-17T10:00:00Z",
      newestAt: "2026-08-17T11:00:00Z",
    },
    now: Date.parse("2026-08-17T12:00:00Z"),
    username: "alice",
    ...overrides,
  };
}

function dashboardsView(overrides: Partial<DashboardsView> = {}): DashboardsView {
  return {
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    spaceKey: "kb25",
    tree: [],
    titles: new Map([["kb25", "KB25"]]),
    spaceTitle: "KB25",
    cards: [
      {
        href: "/_dashboard/tasks?space=kb25",
        title: "Open tasks",
        description: "Task notes left on pages.",
        value: "3",
        valueLabel: "open tasks",
      },
    ],
    username: "alice",
    ...overrides,
  };
}

function labelsView(overrides: Partial<LabelsDashboardView> = {}): LabelsDashboardView {
  return {
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    spaceKey: "kb25",
    tree: [],
    titles: new Map([
      ["kb25", "KB25"],
      ["kb25/ops", "Operations"],
    ]),
    spaceTitle: "KB25",
    labelSet: [
      { name: "Draft", color: "yellow" },
      { name: "Needs review", color: "orange" },
    ],
    known: [
      { name: "Draft", color: "yellow", defined: true, count: 2 },
      { name: "Needs review", color: "orange", defined: true, count: 0 },
      { name: "Legacy", color: "gray", defined: false, count: 1 },
    ],
    selected: ["draft"],
    query: "",
    results: [
      { slug: "kb25/ops/deploy", title: "Deploy", labels: ["Draft", "Legacy"], text: "How we ship." },
    ],
    username: "alice",
    ...overrides,
  };
}

test("issue #1: page view carries the edit link + Cmd/Ctrl+E shortcut", () => {
  const html = layout(pageView());
  assert.match(html, /href="\/_edit\/kb25\/notes" data-edit-link/);
  // The shortcut script targets the edit link and binds the E key.
  assert.match(html, /querySelector\("\[data-edit-link\]"\)/);
  assert.match(html, /key\.toLowerCase\(\) !== "e"/);
});

test("issue #1: Help dialog documents the edit shortcut", () => {
  const html = layout(pageView());
  assert.match(html, /Edit the page you are viewing/);
});

test("issue #1: non-editable views have no edit link for the shortcut to fire", () => {
  const html = layout(pageView({ canEdit: false, activeSlug: "", isArchiveView: true }));
  // No Edit anchor is rendered (the trailing `>` distinguishes the tag from the
  // script's `[data-edit-link]` selector, which is always present but inert).
  assert.doesNotMatch(html, /data-edit-link>/);
});

test("issue #7: a page with a formula links KaTeX's stylesheet in <head>", () => {
  const html = layout(pageView({ contentHtml: '<p><span class="katex">x</span></p>' }));
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /<link rel="stylesheet" href="\/_vendor\/katex\/katex\.min\.css" \/>/);
});

test("issue #7: a page without a formula loads no KaTeX stylesheet", () => {
  const html = layout(pageView());
  assert.doesNotMatch(html, /_vendor\/katex/);
});

test("issue #3: the page header exposes a Download-as-Markdown link", () => {
  const html = layout(pageView());
  assert.match(
    html,
    /class="button secondary" href="\/_download\/kb25\/notes" download>Download<\/a>/
  );
});

test("issue #3: the sidebar ⋯ menu exposes a Download link", () => {
  const html = layout(
    pageView({ tree: [node({ slug: "kb25/guide", title: "Guide" })] })
  );
  assert.match(html, /href="\/_download\/kb25\/guide" download>Download<\/a>/);
});

test("issue #3: non-editable / rootless views omit the Download button", () => {
  const html = layout(pageView({ canEdit: false, activeSlug: "", isArchiveView: true }));
  assert.doesNotMatch(html, /_download/);
});

test("copy link: the page header exposes a Copy link button carrying the slug", () => {
  const html = layout(pageView());
  assert.match(
    html,
    /<button type="button" class="button secondary" data-copy-slug="kb25\/notes" data-copy-link>Copy link<\/button>/
  );
});

test("copy link: the sidebar ⋯ menu offers Copy link for a page", () => {
  const html = layout(
    pageView({ tree: [node({ slug: "kb25/guide", title: "Guide" })] })
  );
  assert.match(html, /<button type="button" data-copy-slug="kb25\/guide">Copy link<\/button>/);
});

test("copy link: folders also get a Copy link (header + ⋯ menu)", () => {
  const html = folderLayout(
    folderView({ tree: [node({ slug: "kb25/box", title: "Box", isFolder: true })] })
  );
  // Header button copies the folder's own slug…
  assert.match(html, /data-copy-slug="kb25\/box" data-copy-link>Copy link<\/button>/);
  // …and the sidebar row for a folder offers it too.
  assert.match(html, /<button type="button" data-copy-slug="kb25\/box">Copy link<\/button>/);
});

test("copy link: the shortcut script binds Cmd/Ctrl+Shift+L and copies the slug", () => {
  const html = layout(pageView());
  // Shift-gated L key, distinct from the plain Cmd/Ctrl+E / +S shortcuts.
  assert.match(html, /event\.shiftKey/);
  assert.match(html, /key\.toLowerCase\(\) !== "l"/);
  // It reads the current page's button, falling back to the active sidebar row.
  assert.match(html, /querySelector\("\[data-copy-link\]"\)/);
});

test("copy link: Help dialog documents the copy-link shortcut", () => {
  const html = layout(pageView());
  assert.match(html, /Copy this page's relative link/);
});

test("copy link: non-editable / rootless views omit the header Copy link button", () => {
  const html = layout(pageView({ canEdit: false, activeSlug: "", isArchiveView: true }));
  // No header button is rendered (the script's [data-copy-link] selector remains
  // but is inert without a matching element), so no copyable header control.
  assert.doesNotMatch(html, /data-copy-link>/);
});

test("issue #4: the sidebar Create menu offers Page and Folder", () => {
  const html = layout(pageView());
  assert.match(html, /<summary class="sidebar-link">Create<\/summary>/);
  assert.match(html, /action="\/_create">\s*<input[^>]*value="kb25"[^>]*>\s*<button type="submit">Page<\/button>/);
  // Folder asks for its name in the folder dialog, not in a box inside the menu.
  assert.match(
    html,
    /<button type="button" data-folder-new data-folder-parent="kb25" data-folder-parent-title="KB25">Folder<\/button>/
  );
  // The old single-purpose button is gone.
  assert.doesNotMatch(html, /Create page/);
});

test("only real folders render a folder icon — content sections do not", () => {
  const html = layout(
    pageView({
      tree: [
        // A real folder (pure container).
        node({ slug: "kb25/box", title: "Box", isSection: true, isFolder: true }),
        // A content section: a page that happens to have children — NOT a folder.
        node({
          slug: "kb25/handbook",
          title: "Handbook",
          isSection: true,
          isFolder: false,
        }),
        // A leaf page.
        node({ slug: "kb25/notes", title: "Notes" }),
      ],
    })
  );
  // Exactly one icon instance in the markup (the folder), separate from the CSS rule.
  const icons = html.match(/class="tree-folder-icon"/g) ?? [];
  assert.equal(icons.length, 1);
});

test("only leaf pages get a dot — folders and pages-with-children do not", () => {
  const html = layout(
    pageView({
      tree: [
        // A real folder (pure container) — folder icon, no dot.
        node({ slug: "kb25/box", title: "Box", isSection: true, isFolder: true }),
        // A content section: a page with children — expand caret, no dot.
        node({
          slug: "kb25/handbook",
          title: "Handbook",
          isSection: true,
          isFolder: false,
          children: [node({ slug: "kb25/handbook/intro", title: "Intro" })],
        }),
        // A leaf page — gets the dot.
        node({ slug: "kb25/notes", title: "Notes" }),
      ],
    })
  );
  // Two leaf pages in the tree (Notes + the nested Intro), so exactly two dots.
  const dots = html.match(/class="tree-page-dot"/g) ?? [];
  assert.equal(dots.length, 2);
});

test("issue #4: the sidebar ⋯ menu offers New folder", () => {
  const html = layout(pageView({ tree: [node({ slug: "kb25/guide", title: "Guide" })] }));
  assert.match(
    html,
    /<button type="button" data-folder-new data-folder-parent="kb25\/guide" data-folder-parent-title="Guide">New folder<\/button>/
  );
});

test("the ⋯ menu for a folder shows Rename, not Edit/Download", () => {
  const html = layout(
    pageView({
      tree: [node({ slug: "kb25/box", title: "Box", isSection: true, isFolder: true })],
    })
  );
  // Folder menu offers Rename, opening the folder dialog for that folder…
  assert.match(
    html,
    /<button type="button" data-folder-rename data-folder-slug="kb25\/box" data-folder-title="Box">Rename<\/button>/
  );
  // …and omits the page-only Edit/Download actions for that node.
  assert.doesNotMatch(html, /href="\/_edit\/kb25\/box"/);
  assert.doesNotMatch(html, /href="\/_download\/kb25\/box"/);
});

function folderView(overrides: Partial<FolderView> = {}): FolderView {
  return {
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    spaceKey: "kb25",
    tree: [],
    activeSlug: "kb25/box",
    titles: new Map([["kb25/box", "Box"]]),
    title: "Box",
    children: [],
    username: "alice",
    ...overrides,
  };
}

test("folderLayout lists children and offers create/rename, but no Edit/Download/prose", () => {
  const html = folderLayout(
    folderView({
      children: [
        node({ slug: "kb25/box/sub", title: "Sub", isSection: true, isFolder: true }),
        node({ slug: "kb25/box/note", title: "Note" }),
      ],
    })
  );
  // Contents listing with links to each child.
  assert.match(html, /href="\/kb25\/box\/sub">Sub<\/a>/);
  assert.match(html, /href="\/kb25\/box\/note">Note<\/a>/);
  // Create-inside + rename controls, both opening the folder dialog.
  assert.match(
    html,
    /<button type="button" class="button secondary" data-folder-new data-folder-parent="kb25\/box" data-folder-parent-title="Box">New folder<\/button>/
  );
  assert.match(
    html,
    /<button type="button" class="button secondary" data-folder-rename data-folder-slug="kb25\/box" data-folder-title="Box">Rename<\/button>/
  );
  // A folder is not editable/downloadable and has no prose body.
  assert.doesNotMatch(html, /data-edit-link>/);
  assert.doesNotMatch(html, /_download/);
  assert.doesNotMatch(html, /class="prose"/);
});

test("folderLayout shows an empty-state when the folder has no items", () => {
  const html = folderLayout(folderView({ children: [] }));
  assert.match(html, /This folder is empty/);
});

function spacesView(overrides: Partial<SpacesView> = {}): SpacesView {
  return {
    siteTitle: "KB",
    spaces: [
      { key: "kb25", title: "KB25", summary: "Notes", icon: "📘", archived: false },
    ],
    username: "alice",
    ...overrides,
  };
}

test("TODO #1: each space card carries a ⋯ menu with Rename, Archive, Delete", () => {
  const html = spacesLayout(spacesView());
  // The card link and the menu are siblings (the menu can't nest in the <a>).
  assert.match(html, /class="space-card-wrap"/);
  assert.match(html, /<summary aria-label="Space actions">⋯<\/summary>/);
  // Edit the name in place — inline rename posting the space key + new title.
  assert.match(
    html,
    /action="\/_rename-space">[\s\S]*?name="key"[^>]*value="kb25"[\s\S]*?name="title"[^>]*value="KB25"/
  );
  // Archive the whole space.
  assert.match(
    html,
    /action="\/_archive-space">[\s\S]*?value="kb25"[\s\S]*?<button type="submit">Archive<\/button>/
  );
  // Delete goes through a confirmation route.
  assert.match(html, /href="\/_delete-space\/kb25">Delete<\/a>/);
});

test("TODO #1: confirmDelete renders a scary confirmation posting to _delete-space", () => {
  const html = spacesLayout(spacesView({ confirmDelete: { key: "kb25", title: "KB25" } }));
  assert.match(html, /Delete the “KB25” space\?/);
  assert.match(html, /its Git history/);
  assert.match(
    html,
    /action="\/_delete-space\/kb25">[\s\S]*?<button class="button danger" type="submit">Delete space<\/button>/
  );
  // Cancel bails back to the grid.
  assert.match(html, /href="\/">Cancel<\/a>/);
});

test("search: the in-space sidebar renders a combobox scoped to the space", () => {
  const html = layout(pageView());
  assert.match(html, /data-search-space="kb25"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="kb-search-results"/);
  assert.match(html, /id="kb-search-results"[\s\S]*?role="listbox"/);
  // The drop strip it replaced is gone.
  assert.doesNotMatch(html, /Move to space root/);
  assert.doesNotMatch(html, /class="root-drop"/);
});

test("search: every in-space layout gets the box, since sidebarHtml carries it", () => {
  assert.match(folderLayout(folderView()), /data-search-input/);
});

test("search: views without a space render neither the box nor its script", () => {
  const html = layout(pageView({ spaceKey: "", activeSlug: "", isArchiveView: true }));
  assert.doesNotMatch(html, /data-search-space/);
  assert.doesNotMatch(html, /data-search-input/);
});

test("search: the shortcut script binds Cmd/Ctrl+K and the Help dialog documents it", () => {
  const html = layout(pageView());
  assert.match(html, /key\.toLowerCase\(\) !== "k"/);
  assert.match(html, /Search this space from the sidebar/);
});

test("search: highlighting builds <mark> nodes rather than assigning HTML", () => {
  const html = layout(pageView());
  // The endpoint sends plain text; the client must never route it through HTML.
  assert.match(html, /createElement\("mark"\)/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("search: the space name takes over as the move-to-space-root drop target", () => {
  const html = layout(pageView());
  assert.match(html, /class="space-current" href="\/kb25" data-drop-slug="kb25"/);
  // MOVE_SCRIPT discovers it through the selector it already uses.
  assert.match(html, /querySelectorAll\("\[data-drop-slug\], \[data-drop-root\]"\)/);
});

test("search: the move-error banner survives, along with the code that writes to it", () => {
  const html = layout(pageView());
  assert.match(html, /class="move-error" data-move-error hidden/);
  assert.match(html, /querySelector\("\[data-move-error\]"\)/);
});

test("tree rows open with exactly one marker glyph, so carets and dots share a column", () => {
  const html = layout(
    pageView({
      tree: [
        // A page with children: gets the caret.
        node({
          slug: "kb25/handbook",
          title: "Handbook",
          isSection: true,
          children: [node({ slug: "kb25/handbook/intro", title: "Intro" })],
        }),
        // A leaf page: gets the dot, in the caret's column.
        node({ slug: "kb25/notes", title: "Notes" }),
        // A folder: spacer or caret in that column, then its own icon.
        node({ slug: "kb25/box", title: "Box", isSection: true, isFolder: true }),
      ],
    })
  );

  const rows = html.match(/<div class="tree-row">[\s\S]*?<a /g) ?? [];
  assert.equal(rows.length, 4, "one row per node, children included");
  for (const row of rows) {
    const markers = [...row.matchAll(/class="(tree-toggle|tree-toggle-spacer|tree-page-dot)"/g)];
    // Exactly one, and first — anything else would offset the glyph sideways.
    assert.equal(markers.length, 1, `expected a single marker, got ${markers.length} in ${row}`);
    assert.match(row, /^<div class="tree-row">(<button type="button" class="tree-toggle"|<span class="tree-toggle-spacer"|<svg class="tree-page-dot")/);
  }
});

test("the open page's row is marked as the current page", () => {
  const html = layout(
    pageView({
      tree: [
        node({
          slug: "kb25/handbook",
          title: "Handbook",
          isSection: true,
          children: [node({ slug: "kb25/notes", title: "Notes" })],
        }),
      ],
      activeSlug: "kb25/notes",
    })
  );

  // The whole attribute run, in order: MOVE_SCRIPT and COPY_LINK_SCRIPT select
  // `.tree a.active[data-drag-slug]`, so the class must keep its exact slot.
  assert.match(
    html,
    /class="active" aria-current="page" draggable="true" data-drag-slug="kb25\/notes"/
  );
  // One page is open, so exactly one row claims to be it.
  assert.equal([...html.matchAll(/aria-current="page"/g)].length, 1);
});

test("a view with no open page marks no row as current", () => {
  // The dashboard passes activeSlug: "", which must not match a real slug.
  assert.doesNotMatch(dashboardLayout(dashboardView()), /aria-current/);
});

/** A tree three groups deep on one side, so every rule below has a row to land on. */
function branchyTree(): PageNode[] {
  return [
    node({
      slug: "kb25/handbook",
      title: "Handbook",
      isSection: true,
      children: [
        node({
          slug: "kb25/handbook/intro",
          title: "Intro",
          isSection: true,
          children: [
            node({
              slug: "kb25/handbook/intro/setup",
              title: "Setup",
              isSection: true,
              children: [node({ slug: "kb25/handbook/intro/setup/mac", title: "Mac" })],
            }),
          ],
        }),
        node({
          slug: "kb25/handbook/style",
          title: "Style",
          isSection: true,
          children: [node({ slug: "kb25/handbook/style/tone", title: "Tone" })],
        }),
      ],
    }),
    node({
      slug: "kb25/ops",
      title: "Ops",
      isSection: true,
      children: [node({ slug: "kb25/ops/deploy", title: "Deploy" })],
    }),
  ];
}

/** How a group rendered: whether its <li> is shut and what its caret announces. */
function groupState(html: string, slug: string): { collapsed: boolean; ariaExpanded: string } {
  const m = html.match(
    new RegExp(
      `<li data-tree-slug="${slug.replace(/\//g, "\\/")}"( class="collapsed")?><div class="tree-row"><button type="button" class="tree-toggle" aria-label="Toggle subpages" aria-expanded="(true|false)">`
    )
  );
  assert.ok(m, `no group row for ${slug}`);
  return { collapsed: !!m[1], ariaExpanded: m[2] };
}

test("only the open page's branch renders expanded", () => {
  const html = layout(pageView({ tree: branchyTree(), activeSlug: "kb25/handbook/intro" }));

  // The ancestor, so the open row is on screen, and the open page itself, so
  // its children are listed.
  assert.deepEqual(groupState(html, "kb25/handbook"), { collapsed: false, ariaExpanded: "true" });
  assert.deepEqual(groupState(html, "kb25/handbook/intro"), { collapsed: false, ariaExpanded: "true" });
  // Below the open page, beside it, and in another branch: all shut.
  assert.deepEqual(groupState(html, "kb25/handbook/intro/setup"), { collapsed: true, ariaExpanded: "false" });
  assert.deepEqual(groupState(html, "kb25/handbook/style"), { collapsed: true, ariaExpanded: "false" });
  assert.deepEqual(groupState(html, "kb25/ops"), { collapsed: true, ariaExpanded: "false" });
});

test("a leaf deep in the tree opens every group above it and nothing else", () => {
  const html = layout(pageView({ tree: branchyTree(), activeSlug: "kb25/handbook/intro/setup/mac" }));
  for (const slug of ["kb25/handbook", "kb25/handbook/intro", "kb25/handbook/intro/setup"]) {
    assert.equal(groupState(html, slug).collapsed, false, slug);
  }
  for (const slug of ["kb25/handbook/style", "kb25/ops"]) {
    assert.equal(groupState(html, slug).collapsed, true, slug);
  }
});

test("a view with no open page renders every group collapsed", () => {
  const html = dashboardLayout(dashboardView({ tree: branchyTree() }));
  for (const slug of [
    "kb25/handbook",
    "kb25/handbook/intro",
    "kb25/handbook/intro/setup",
    "kb25/handbook/style",
    "kb25/ops",
  ]) {
    assert.equal(groupState(html, slug).collapsed, true, slug);
  }
});

test("the archive tree has no carets, so it never renders a group shut", () => {
  const html = layout(pageView({ isArchiveView: true, activeSlug: "", tree: branchyTree() }));
  assert.doesNotMatch(html, /<li [^>]*class="collapsed"/);
});

/**
 * Nothing about the tree is remembered across navigation: the server decides
 * what is open, and the script only carries hand-opened groups over a reload of
 * the very same page. None of this executes under `npm test`, so these assert
 * on the emitted source; the runtime behaviour has to be driven in a browser.
 */
test("the collapse scripts keep nothing beyond a reload of the same page", () => {
  const html = layout(pageView());
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const place = scripts.find((s) => s.includes("sessionStorage.getItem(EXPANDED_KEY)"));
  const move = scripts.find((s) => s.includes("sessionStorage.setItem(EXPANDED_KEY"));
  assert.ok(place, "the script that reopens the tree is emitted with the page");
  assert.ok(move, "the script that writes the hand-off is emitted with the page");

  // Both ends of the hand-off agree on its key, and localStorage is only ever
  // cleared of what older versions left there.
  for (const src of [place, move]) {
    assert.match(src, /const EXPANDED_KEY = "kb:expanded";/);
    assert.doesNotMatch(src, /localStorage\.setItem/);
  }
  assert.match(move, /localStorage\.removeItem\("kb:collapsed"\)/);
  // The hand-off is consumed by whichever page loads next, and honoured only
  // when that load is a reload of the URL that wrote it.
  assert.match(place, /sessionStorage\.removeItem\(EXPANDED_KEY\)/);
  assert.match(place, /saved\.url === location\.href && nav && nav\.type === "reload"/);
  // The row is scrolled into view by moving the sidebar's own scroll box, so
  // the window never travels with it.
  assert.match(place, /pane\.scrollTop \+=/);
});

/**
 * A browser may paint while it is still parsing the article and the scripts at
 * the end of <body>. When those scripts placed the tree, such a paint showed the
 * top of it for a frame before it jumped to the open page's row.
 */
test("the sidebar is opened and scrolled before the page can paint it", () => {
  const html = layout(pageView());
  const aside = html.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)?.[0];
  assert.ok(aside, "the page has a sidebar");
  // The placing script runs straight after the tree, and the marker that lifts
  // the paint hold follows it: Chromium lifts the hold as soon as the marker is
  // inserted, so a marker wrapping the script would lift it too early.
  assert.match(
    aside,
    /<\/nav>\s*<script>[\s\S]*?pane\.scrollTop \+=[\s\S]*?<\/script>\s*<span id="kb-sidebar-placed" hidden><\/span>\s*<\/aside>$/
  );
  assert.match(html, /<head>[\s\S]*<link rel="expect" href="#kb-sidebar-placed" blocking="render" \/>[\s\S]*<\/head>/);
  // Nothing after the sidebar moves it any more.
  assert.doesNotMatch(html.slice(html.indexOf("</aside>")), /scrollTop \+=/);
});

test("every view with a sidebar holds the first paint for it, and only those", () => {
  const views: Array<[string, string]> = [
    ["page", layout(pageView())],
    ["archived page", layout(pageView({ isArchiveView: true }))],
    ["outside a space", layout(pageView({ spaceKey: "", tree: [], activeSlug: "" }))],
    ["folder", folderLayout(folderView())],
    ["edit", editLayout(editView())],
    ["dashboard", dashboardLayout(dashboardView())],
    ["login", loginLayout({ siteTitle: "KB", next: "/" } as LoginView)],
    ["spaces", spacesLayout(spacesView())],
  ];
  for (const [name, html] of views) {
    const sidebar = html.includes('<aside class="sidebar">');
    assert.equal(/<link rel="expect" href="#kb-sidebar-placed" blocking="render" \/>/.test(html), sidebar, name);
    // Without its marker, a held page would stay unpainted until it all parsed.
    if (sidebar) assert.match(html, /<span id="kb-sidebar-placed" hidden><\/span>\s*<\/aside>/, name);
  }
});

test("a shift-click range skips rows folded away inside a collapsed group", () => {
  const html = layout(pageView());
  const move = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("function selectRange"));
  assert.ok(move, "the selection script is emitted with the page");
  // Groups start collapsed, so a range across top-level rows would otherwise
  // sweep up every hidden descendant between them and drag it along.
  assert.match(move, /if \(orderedLinks\[i\]\.offsetParent !== null\) selected\.add/);
});

test("issue #2: every group gets an insertion line above each row and one closing it", () => {
  const html = layout(
    pageView({
      tree: [
        node({
          slug: "kb25/handbook",
          title: "Handbook",
          isSection: true,
          children: [node({ slug: "kb25/handbook/intro", title: "Intro" })],
        }),
        node({ slug: "kb25/notes", title: "Notes" }),
      ],
    })
  );

  // Top level: above handbook, above notes, and one appending to the space root.
  assert.match(html, /<li class="drop-line" data-drop-line data-drop-parent="kb25" data-drop-before="kb25\/handbook"><\/li><li data-tree-slug="kb25\/handbook"[^>]*>/);
  assert.match(html, /<li class="drop-line" data-drop-line data-drop-parent="kb25" data-drop-before="kb25\/notes"><\/li><li data-tree-slug="kb25\/notes">/);
  // The closing line of a group carries no anchor — that means "append here".
  assert.match(html, /<li class="drop-line" data-drop-line data-drop-parent="kb25"><\/li><\/ul>/);
  // A child group reports its own parent, so a drop there nests rather than lifts.
  assert.match(html, /data-drop-parent="kb25\/handbook" data-drop-before="kb25\/handbook\/intro"/);
  assert.match(html, /<li class="drop-line" data-drop-line data-drop-parent="kb25\/handbook"><\/li>/);

  // Zero height, invisible until targeted: a tree at rest looks untouched. The
  // 2px indicator straddles a row boundary, so it must not take the hit test from
  // the row edge the pointer is aiming at — that would swallow the dragover.
  assert.match(html, /\.tree \.drop-line\{position:relative; height:0; pointer-events:none\}/);
  assert.match(html, /\.tree \.drop-line::before\{[^}]*opacity:0/);
  assert.match(html, /\.tree \.drop-line\.drop-line-active::before\{opacity:1\}/);
});

test("issue #2: the archive view renders no insertion lines, since it cannot drag", () => {
  const html = layout(
    pageView({
      isArchiveView: true,
      tree: [node({ slug: "kb25/notes", title: "Notes", archived: true })],
    })
  );
  assert.doesNotMatch(html, /data-drop-line/);
});

test("issue #2: a line drop posts to /_reorder and stays on the current page", () => {
  const html = layout(pageView());
  assert.match(html, /fetch\(url, \{/);
  assert.match(html, /"\/_reorder",/);
  assert.match(html, /parentSlug: line\.getAttribute\("data-drop-parent"\)/);
  assert.match(html, /beforeSlug: line\.getAttribute\("data-drop-before"\)/);
  // Arranging pages reloads in place; only a page that moved is followed.
  assert.match(html, /window\.location\.reload\(\)/);
});

test("copy link: a toast is created up front and rises from below on copy", () => {
  const html = layout(pageView());
  // Built on init, not on first use, so the aria-live region pre-exists its message.
  assert.match(html, /createElement\("div"\)/);
  assert.match(html, /toast\.setAttribute\("aria-live", "polite"\)/);
  // The wording names what was copied; a control with no label copies a link.
  assert.match(html, /\(label \|\| "Link"\) \+ " copied"/);
  assert.match(html, /"Copy failed"/);
  // Class flip is deferred a frame so the offscreen start position gets painted.
  assert.match(html, /requestAnimationFrame\(\(\) => toast\.classList\.add\("is-visible"\)\)/);
  // Travels up from below the bottom edge, and fades in place under reduced motion.
  assert.match(html, /\.toast\{[\s\S]*?transform:translate\(-50%,calc\(100% \+ 24px\)\)/);
  assert.match(html, /\.toast\.is-visible\{opacity:1; transform:translate\(-50%,0\)\}/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{[\s\S]*?\.toast\{transform:translate\(-50%,0\)/);
  // The toast carries the wording now, so the button no longer swaps its label.
  assert.doesNotMatch(html, /copyLabel/);
});

test("notes: the page view carries its notes as an escaped JSON payload", () => {
  const html = layout(
    pageView({
      notes: [
        {
          id: "n7k2m4x8",
          kind: "task",
          at: "2026-08-10T09:12:04Z",
          by: "alice",
          quote: "restart the workers",
          text: 'Stale — use <b>rolling</b> restart & "the script".',
          line: 4,
        },
      ],
    })
  );
  assert.match(html, /<div id="kb25-notes" hidden data-slug="kb25\/notes" data-notes="/);
  // Everything that could break out of the attribute or the document is escaped.
  assert.match(html, /&quot;n7k2m4x8&quot;/);
  assert.match(html, /&lt;b&gt;rolling&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>rolling<\/b>/);
});

test("notes: the payload ships even with no notes, so the composer can post", () => {
  const html = layout(pageView());
  assert.match(html, /data-slug="kb25\/notes" data-notes="\[\]"/);
  assert.match(html, /fetch\("\/_notes\/" \+ slug/);
});

test("notes: highlights are built as nodes, never assigned as HTML", () => {
  const html = layout(pageView());
  assert.match(html, /document\.createElement\("mark"\)/);
  assert.match(html, /createTreeWalker\(block, NodeFilter\.SHOW_TEXT\)/);
  // The whole feature writes user- and agent-authored text into the page.
  assert.doesNotMatch(html, /innerHTML/);
});

test("notes: a link in a note's text is drawn as an anchor, still without HTML", () => {
  const html = layout(
    pageView({
      notes: [
        {
          id: "d1ggvluu",
          kind: "agent",
          at: "2026-09-11T11:36:25Z",
          by: "agent",
          text: "See FDT-230.",
          segments: [{ text: "See " }, { text: "FDT-230", href: "/data/fdt-230" }],
          line: 4,
        },
      ],
    })
  );
  // The segments ride along in the payload the client reads.
  assert.match(html, /&quot;href&quot;:&quot;\/data\/fdt-230&quot;/);
  // And are put on a real anchor, node by node, never as markup.
  assert.match(html, /link\.href = segment\.href/);
  assert.match(html, /link\.textContent = segment\.text/);
  assert.match(html, /createTextNode\(segment\.text\)/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("notes: a note with no links falls back to its plain text", () => {
  const html = layout(pageView());
  assert.match(html, /if \(!note\.segments\) \{\n\s*target\.textContent = note\.text;/);
});

test("notes: the composer keeps the selection alive across its own mousedown", () => {
  const html = layout(pageView());
  // Without this the button collapses the selection before the click fires.
  assert.match(html, /addButton\.addEventListener\("mousedown", \(event\) => event\.preventDefault\(\)\)/);
});

test("notes: whitespace normalization survives the template literal intact", () => {
  const html = layout(pageView());
  // A single backslash here would make this /s+/ and quietly break every quote
  // containing the letter s.
  assert.match(html, /text\.replace\(\/\\s\+\/g, " "\)/);
});

test("notes: a read-only or archive view ships neither the payload nor the script", () => {
  for (const view of [pageView({ canEdit: false }), pageView({ isArchiveView: true })]) {
    const html = layout(view);
    assert.doesNotMatch(html, /id="kb25-notes"/);
    assert.doesNotMatch(html, /_notes\//);
  }
});

test("notes: a note is rewritten and re-typed in its own card", () => {
  const html = layout(pageView());
  // Editing swaps the card in place rather than opening a second panel...
  assert.match(html, /edit\.addEventListener\("click", \(event\) => swap\(true, event\)\)/);
  // ...and that click stops short of the document: redrawing detaches the very
  // button that was clicked, and the outside-click handler would find no popover
  // above the orphan and close the card out from under the editor.
  assert.match(html, /const swap = \(editing, event\) => \{\s*if \(event\) event\.stopPropagation\(\);/);
  // ...and saving posts the new text and kind against the note's own id, so the
  // note keeps its anchor instead of being resolved and written again.
  assert.match(
    html,
    /send\(\{ op: "edit", noteId: note\.id, text: text, kind: picker\.kind\(\) \}, save\)/
  );
  // The kind switch is the composer's, so both paths offer all three kinds.
  assert.match(html, /function kindPicker\(current, onChange\)/);
  assert.match(html, /const picker = kindPicker\(note\.kind, \(kind\) =>/);
  assert.match(html, /const picker = kindPicker\("highlight", \(kind\) =>/);
});

test("notes: the switch offers highlight, remark, task — highlight first", () => {
  const html = layout(pageView());
  assert.match(
    html,
    /\["highlight", "Highlight",[^\]]+\],\s*\["remark", "Remark",[^\]]+\],\s*\["task", "Task",/
  );
  // A highlight is the mark itself, so it is the one kind that saves empty —
  // which is the whole point of not having to type "!!" into a remark.
  assert.equal(html.split(/!text && picker\.kind\(\) !== "highlight"/).length - 1, 2);
  // ...and the card it is read in shows no empty text block where its words aren't.
  assert.match(html, /if \(note\.text\) \{\s*const body = document\.createElement\("div"\)/);
});

test("notes: tasks are purple, highlights underline yellow, remarks stay teal", () => {
  const html = layout(pageView());
  // Every theme block defines both palettes; one missing them renders unstyled.
  assert.equal(html.split("--task-bg:").length - 1, 3);
  assert.equal(html.split("--highlight-bg:").length - 1, 3);
  assert.match(html, /--task-pin:#a855f7/);
  // The highlight pin is the one token that cannot be shared across themes: a
  // yellow dark enough to be seen on white disappears on the dark page.
  assert.equal(html.split("--highlight-pin:#9aa300").length - 1, 1);
  assert.equal(html.split("--highlight-pin:#e2e800").length - 1, 2);
  // The kind's palette rides on the element, so the rules that draw a note are
  // shared and a remark keeps the teal it always had.
  assert.match(html, /\.note-mark\.is-task,[^{]+\{\s*--note-bg:var\(--task-bg\)/);
  assert.match(html, /\.note-mark\.is-highlight,[^{]+\{\s*--note-bg:var\(--highlight-bg\)/);
  assert.match(html, /\.note-kind\.is-remark\{background:var\(--surface-hover\)/);
  assert.match(html, /mark\.className = "note-mark is-" \+ note\.kind/);
  // In prose, a highlight is only a yellow underline: it does not repaint the
  // words or cover them with the palette used by its pin and kind badge.
  assert.match(
    html,
    /\.prose mark\.note-mark\.is-highlight\{\s*background:transparent; color:inherit;[^}]+text-decoration-line:underline; text-decoration-color:var\(--note-pin\)/
  );
  assert.match(
    html,
    /\.prose mark\.note-mark\.is-highlight\.is-active\{\s*background:transparent; text-decoration-thickness:/
  );
  // One pin per block, coloured by the loudest kind on it.
  assert.match(html, /pin\.classList\.toggle\("is-task", loudest === "task"\)/);
  assert.match(html, /pin\.classList\.toggle\("is-highlight", loudest === "highlight"\)/);
});

test("notes: an agent's note is pink, and a reader can only resolve it", () => {
  const html = layout(pageView());
  // Every theme block defines the palette; one missing it renders unstyled.
  for (const token of [
    "--agent-bg:",
    "--agent-bg-strong:",
    "--agent-fg:",
    "--agent-pin:",
    "--agent-border:",
  ]) {
    assert.equal(html.split(token).length - 1, 3, token + " is not in all three theme blocks");
  }
  // Pink is legible on white and on black, so the pin carries one value across
  // all three — the split the highlight's yellow needs is not needed here.
  assert.equal(html.split("--agent-pin:#ff2d87").length - 1, 3);
  assert.match(html, /\.note-mark\.is-agent,[^{]+\{\s*--note-bg:var\(--agent-bg\)/);
  // No .note-kind-option, because the switch never offers a kind nobody can
  // write — so the chip needs a name from somewhere other than KINDS.
  assert.doesNotMatch(html, /\.note-kind-option\.is-agent/);
  assert.match(html, /const LABELS = \{[^}]*agent: "Agent"/);
  // The pin is coloured for it above a remark and below a task, and colouring it
  // at all takes a fourth toggle — without one the pin falls back to the base
  // token and an agent note reads as a remark.
  assert.match(html, /kinds\.includes\("task"\)\s*\? "task"\s*: kinds\.includes\("agent"\)/);
  assert.match(html, /pin\.classList\.toggle\("is-agent", loudest === "agent"\)/);
  // Resolve and nothing else: an agent's note is the agent's own words.
  assert.match(html, /if \(note\.kind !== "agent"\) \{\s*const edit = actionButton\("Edit"/);
  // And the chip names the writer, so the byline does not say it twice.
  assert.match(html, /const by = note\.kind === "agent" \? "" : note\.by;/);
});

test("notes: the kind switch gets its own row, so no kind is clipped", () => {
  const html = layout(pageView());
  // Three kinds beside Cancel and Save overflow the 320px panel, and .note-kinds
  // hides its overflow — which silently swallowed the third option.
  assert.match(html, /\.note-kinds\{display:flex; flex:1 0 100%/);
  assert.match(html, /\.note-composer-actions,\.note-card-actions\{[^}]*flex-wrap:wrap/);
});

test("notes: the pin finds a legal host inside list and table blocks", () => {
  const html = layout(pageView());
  // A <button> is invalid as a direct child of <ul>/<ol>/<table>.
  assert.match(html, /if \(tag === "UL" \|\| tag === "OL"\) return block\.querySelector\("li"\)/);
  assert.match(html, /if \(tag === "TABLE"\) return block\.querySelector\("th, td"\)/);
});

test("dashboard: the corner button links to the space being viewed", () => {
  const html = layout(pageView());
  assert.match(html, /class="dash-button" href="\/_dashboard\?space=kb25"/);
});

test("dashboards: the corner button is named for the hub it opens", () => {
  const html = layout(pageView());
  assert.match(html, /class="dash-button"[^>]*aria-label="Dashboards" title="Dashboards"/);
  assert.doesNotMatch(html, /Notes dashboard/);
});

test("dashboards: the hub lists each report as a card with its number", () => {
  const html = dashboardsLayout(dashboardsView());
  assert.match(html, /<title>KB25 · Dashboards · KB<\/title>/);
  assert.match(
    html,
    /<a class="hub-card" href="\/_dashboard\/tasks\?space=kb25">\s*<span class="hub-title">Open tasks<\/span>/
  );
  assert.match(html, /<span class="stat-value">3<\/span> <span class="stat-label">open tasks<\/span>/);
  assert.match(html, /<span class="hub-desc">Task notes left on pages\.<\/span>/);
});

test("dashboards: a card's link and words are escaped", () => {
  const html = dashboardsLayout(
    dashboardsView({
      cards: [
        {
          href: "/_dashboard/labels?space=kb25&label=a",
          title: "<b>x</b>",
          description: "a & b",
          value: "1",
          valueLabel: "label",
        },
      ],
    })
  );
  assert.match(html, /href="\/_dashboard\/labels\?space=kb25&amp;label=a"/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /a &amp; b/);
});

test("dashboards: the tasks report links back to the hub", () => {
  const html = dashboardLayout(dashboardView());
  assert.match(html, /<a class="dash-back" href="\/_dashboard\?space=kb25">← Dashboards<\/a>/);
});

test("dashboard: no button outside a space, where it would report on nothing", () => {
  // The spaces home page has no current space — the same reason it ships no
  // sidebar search.
  const html = spacesLayout({
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    username: "alice",
  } satisfies SpacesView);
  // The stylesheet still carries the rule — it is the anchor that must be absent.
  assert.doesNotMatch(html, /class="dash-button"/);
  assert.doesNotMatch(html, /href="\/_dashboard/);
});

test("dashboard: the space key is URL-encoded, not pasted into the href raw", () => {
  const html = layout(pageView({ spaceKey: "a b&c" }));
  assert.match(html, /href="\/_dashboard\?space=a%20b%26c"/);
});

test("dashboard: each task links to its own note anchor, not the page top", () => {
  const html = dashboardLayout(dashboardView());
  assert.match(html, /href="\/kb25\/deploy#note-aaa11111"/);
  assert.match(html, /class="task-count">2</);
});

test("dashboard: a positional note id survives the trip into the fragment", () => {
  // A hand-written note with no id= gets an `@<line>` one; unencoded it would not
  // survive the URL, and the client decodes it back before the lookup.
  const html = dashboardLayout(
    dashboardView({
      groups: [
        {
          slug: "kb25/deploy",
          title: "Deploy",
          notes: [note({ id: "@12" })],
        },
      ],
    })
  );
  assert.match(html, /#note-%4012"/);
});

test("dashboard: each task carries a copy button holding its note reference", () => {
  const html = dashboardLayout(dashboardView());
  // Copied value is the id qualified by its page, so pasting it into a chat names
  // both; the visible label is the bare id, to match against later.
  assert.match(
    html,
    /<button type="button" class="task-copy" data-copy-slug="kb25\/deploy#aaa11111" data-copy-label="Note ID"/
  );
  assert.match(html, /<span class="task-id">aaa11111<\/span>/);
  assert.match(html, /data-copy-slug="kb25\/deploy#bbb22222"/);
});

test("dashboard: the copy button is a sibling of the row link, not nested in it", () => {
  // A <button> inside an <a> is invalid, and the click would fight the anchor.
  const html = dashboardLayout(dashboardView());
  assert.match(html, /<\/a>\s*<button type="button" class="task-copy"/);
});

test("dashboard: the copy button reuses the shared clipboard handler", () => {
  const html = dashboardLayout(dashboardView());
  // Same delegated [data-copy-slug] listener as Copy link — no second script.
  assert.match(html, /target\.closest\("\[data-copy-slug\]"\)/);
  // …which names what it copied, so this one's toast reads "Note ID copied".
  assert.match(html, /getAttribute\("data-copy-label"\)/);
  assert.match(html, /\(label \|\| "Link"\) \+ " copied"/);
});

test("dashboard: a note reference is escaped, quotes included", () => {
  const html = dashboardLayout(
    dashboardView({
      groups: [
        { slug: 'kb25/a"b', title: "Odd", notes: [note({ id: '"><img src=x>' })] },
      ],
    })
  );
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /data-copy-slug="kb25\/a&quot;b#&quot;&gt;&lt;img src=x&gt;"/);
});

test("dashboard: a positional id is copied with its page, which is what locates it", () => {
  // `@12` counts lines in one body and means nothing on its own; the slug is what
  // makes the pasted reference resolvable.
  const html = dashboardLayout(
    dashboardView({
      groups: [{ slug: "kb25/deploy", title: "Deploy", notes: [note({ id: "@12" })] }],
    })
  );
  assert.match(html, /data-copy-slug="kb25\/deploy#@12"/);
});

test("dashboard: note text and quotes are escaped, never trusted as markup", () => {
  const html = dashboardLayout(
    dashboardView({
      groups: [
        {
          slug: "kb25/deploy",
          title: "<script>t</script>",
          notes: [
            note({ text: "<script>alert(1)</script>", quote: "<img src=x onerror=1>" }),
          ],
        },
      ],
    })
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("dashboard: a page's location reads as section titles, not slug segments", () => {
  const html = dashboardLayout(
    dashboardView({
      titles: new Map([
        ["kb25", "KB25"],
        ["kb25/runbooks", "Runbooks"],
        ["kb25/runbooks/deep", "Deep Dives"],
        ["kb25/runbooks/deep/deploy", "Deploy"],
      ]),
      groups: [
        { slug: "kb25/runbooks/deep/deploy", title: "Deploy", notes: [note()] },
      ],
    })
  );
  // The space is implied and the leaf is already the heading beside it.
  assert.match(html, /class="task-crumb">Runbooks \/ Deep Dives</);
  assert.doesNotMatch(html, /task-crumb">kb25/);
});

test("dashboard: an untitled section falls back to its slug segment", () => {
  const html = dashboardLayout(
    dashboardView({
      titles: new Map([["kb25", "KB25"]]),
      groups: [{ slug: "kb25/runbooks/deploy", title: "Deploy", notes: [note()] }],
    })
  );
  assert.match(html, /class="task-crumb">runbooks</);
});

test("dashboard: a page at the space root gets no location line at all", () => {
  const html = dashboardLayout(
    dashboardView({ groups: [{ slug: "kb25/deploy", title: "Deploy", notes: [note()] }] })
  );
  // The stylesheet still carries the rule — it is the span that must be absent.
  assert.doesNotMatch(html, /class="task-crumb"/);
});

test("dashboard: the counts are pluralized against what they count", () => {
  const one = dashboardLayout(
    dashboardView({
      summary: { total: 1, pages: 1, oldestAt: "", newestAt: "" },
    })
  );
  assert.match(one, /<span class="stat-label">open task<\/span>/);
  assert.match(one, /<span class="stat-label">page<\/span>/);

  const many = dashboardLayout(dashboardView());
  assert.match(many, /<span class="stat-label">open tasks<\/span>/);
  assert.match(many, /<span class="stat-label">pages<\/span>/);
});

test("dashboard: an empty space says so instead of showing a bare heading", () => {
  const html = dashboardLayout(
    dashboardView({ groups: [], summary: { total: 0, pages: 0, oldestAt: "", newestAt: "" } })
  );
  assert.match(html, /No task notes in <strong>KB25<\/strong>/);
  // The oldest-age card has nothing to report, and says nothing rather than "0".
  assert.match(html, /<span class="stat-value">—<\/span>/);
});

test("dashboard: a task with no message reads as a bare mark, not a blank row", () => {
  const html = dashboardLayout(
    dashboardView({
      groups: [
        { slug: "kb25/deploy", title: "Deploy", notes: [note({ text: "" })] },
      ],
    })
  );
  assert.match(html, /No message — just marked\./);
});

test("dashboard: the page's own notes payload and script stay off it", () => {
  // canEdit:false, so there is nothing to annotate here and NOTES_SCRIPT — which
  // would find no article of notes — is not shipped.
  const html = dashboardLayout(dashboardView());
  assert.doesNotMatch(html, /id="kb25-notes"/);
});

test("dashboard: a #note-<id> fragment scrolls to that note and opens it", () => {
  const html = layout(pageView());
  assert.match(html, /location\.hash \|\| ""\)\.replace\(\/\^#note-\/, ""\)/);
  assert.match(html, /anchor\.scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(html, /openPopover\(anchor, \[id\]\)/);
  assert.match(html, /window\.addEventListener\("hashchange", focusFromHash\)/);
  // Ids are compared by splitting the attribute, not with a ~= selector that an
  // `@<line>` id would break.
  assert.doesNotMatch(html, /data-kb25-notes~=/);
});

// --- space instructions -----------------------------------------------------

function editView(over: Partial<EditView> = {}): EditView {
  return {
    siteTitle: "KB",
    spaces: [{ key: "kb25", title: "KB25", archived: false }],
    spaceKey: "kb25",
    tree: [],
    activeSlug: "kb25/notes",
    titles: new Map([["kb25/notes", "Notes"]]),
    title: "Notes",
    raw: "---\ntitle: Notes\n---\n# Notes\n",
    username: "elmir",
    ...over,
  };
}

test("space instructions: the corner link appears only inside a space", () => {
  const inSpace = dashboardLayout(dashboardView());
  assert.match(inSpace, /class="instructions-button" href="\/_instructions\?space=kb25"/);

  // No active space (the archive browser, a 404) — nothing to point at.
  const noSpace = dashboardLayout(dashboardView({ spaceKey: "" }));
  assert.doesNotMatch(noSpace, /href="\/_instructions/);
});

test("space instructions: the space key is URL-encoded in the link", () => {
  const html = dashboardLayout(dashboardView({ spaceKey: "a b&c" }));
  assert.match(html, /href="\/_instructions\?space=a%20b%26c"/);
  assert.doesNotMatch(html, /space=a b&c/);
});

test("space instructions: an ordinary edit page gets no hint and no counter", () => {
  const html = editLayout(editView());
  // Anchor on the markup, not the bare class: the inlined stylesheet always
  // carries the `.instructions-hint` rule, so a class-name match false-positives.
  assert.doesNotMatch(html, /class="instructions-hint"/);
  assert.doesNotMatch(html, /data-instructions-count/);
  // The slug-rename field is the normal affordance.
  assert.match(html, /<input id="slug" name="slug"/);
});

test("space instructions: the instructions editor swaps slug rename for a counter", () => {
  const html = editLayout(
    editView({
      activeSlug: "kb25/_instructions",
      title: "KB25 instructions",
      instructions: { cap: 2000, spaceTitle: "KB25" },
    })
  );

  assert.match(html, /class="instructions-hint"/);
  assert.match(html, /data-instructions-count/);
  assert.match(html, /<span data-instructions-cap>2000<\/span>/);
  // Renaming this file would break the mechanism that finds it.
  assert.doesNotMatch(html, /<input id="slug" name="slug"/);
  // It still posts to the ordinary editor endpoint.
  assert.match(html, /action="\/_edit\/kb25\/_instructions"/);
});

test("space instructions: the counter script ships only on that editor", () => {
  const plain = editLayout(editView());
  assert.doesNotMatch(plain, /data-instructions-cap/);

  const html = editLayout(
    editView({
      activeSlug: "kb25/_instructions",
      instructions: { cap: 2000, spaceTitle: "KB25" },
    })
  );
  // The counter measures the body, not the frontmatter, since that is what is
  // delivered to the LLM and measured against the cap.
  assert.match(html, /const bodyOf = \(raw\)/);
  assert.match(html, /area\.addEventListener\("input", render\)/);
});

test("space instructions: the space title is escaped in the hint", () => {
  const html = editLayout(
    editView({
      activeSlug: "kb25/_instructions",
      instructions: { cap: 2000, spaceTitle: '<img src=x onerror=alert(1)>' },
    })
  );
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test("space instructions: the hint states it is hidden and LLM-read-only", () => {
  const html = editLayout(
    editView({
      activeSlug: "kb25/_instructions",
      instructions: { cap: 2000, spaceTitle: "KB25" },
    })
  );
  assert.match(html, /hidden from the sidebar and from search/);
  assert.match(html, /the LLM cannot edit it/);
  // The freshness promise is the thing a reader most needs to trust.
  assert.match(html, /no restart needed/);
});

/**
 * Every inline script must at least parse.
 *
 * The client-side code in views.ts lives inside template literals and never
 * executes under `npm test`, so a lone `\n` in a regex or comment silently
 * collapses into a real newline and breaks the whole script — with no test, no
 * typecheck error, and no server-side symptom. Parsing each emitted script is
 * the cheapest guard that catches it.
 */
test("views: every inline script in every layout parses as JavaScript", () => {
  const pages: Array<[string, string]> = [
    ["page", layout(pageView())],
    ["page-toc", layout(pageView({ sections: sections() }))],
    ["folder", folderLayout({ ...pageView(), children: [] } as unknown as FolderView)],
    ["dashboard", dashboardLayout(dashboardView())],
    ["dashboards", dashboardsLayout(dashboardsView())],
    ["labels", labelsDashboardLayout(labelsView())],
    ["spaces", spacesLayout({ siteTitle: "KB", spaces: [], username: "u" } as SpacesView)],
    ["edit", editLayout(editView())],
    [
      "edit-instructions",
      editLayout(
        editView({
          activeSlug: "kb25/_instructions",
          instructions: { cap: 2000, spaceTitle: "KB25" },
        })
      ),
    ],
  ];

  for (const [name, html] of pages) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, `${name}: expected at least one inline script`);
    for (const [i, src] of scripts.entries()) {
      assert.doesNotThrow(
        () => new Function(src),
        `${name}: inline script #${i} does not parse`
      );
    }
  }
});

// --- section linking ---------------------------------------------------------

test("the rail lists the sections it is given, indented by level", () => {
  const html = layout(pageView({ sections: sections() }));
  assert.match(html, /<aside class="toc" aria-label="On this page">/);
  assert.match(html, /<div class="toc-head">On this page<\/div>/);
  assert.match(html, /<li class="toc-item" data-depth="0"><a href="#first" data-section="first">First<\/a>/);
  assert.match(html, /<li class="toc-item" data-depth="1"><a href="#detail" data-section="detail">Detail<\/a>/);
  assert.match(html, /<li class="toc-item" data-depth="0"><a href="#second" data-section="second">Second<\/a>/);
});

test("the rail sits after the content, not inside it", () => {
  const html = layout(pageView({ sections: sections() }));
  assert.ok(html.indexOf("</main>") < html.indexOf('<aside class="toc"'));
});

test("a page with fewer than two sections gets no rail and no scroll script", () => {
  for (const list of [[], sections([{ level: 2, text: "Only", anchor: "only", line: 0 }])]) {
    const html = layout(pageView({ sections: list }));
    assert.doesNotMatch(html, /class="toc"/);
    assert.doesNotMatch(html, /data-section=/);
  }
});

test("a rail entry escapes its heading text and percent-encodes its href", () => {
  const html = layout(
    pageView({
      sections: sections([
        { level: 2, text: "A & B <script>", anchor: "a-b", line: 0 },
        { level: 2, text: "一句话", anchor: "一句话", line: 4 },
      ]),
    })
  );
  assert.match(html, /<a href="#a-b" data-section="a-b">A &amp; B &lt;script&gt;<\/a>/);
  // The href has to be encoded to resolve; data-section stays raw because the
  // script looks the heading up by id.
  assert.match(html, /<a href="#%E4%B8%80%E5%8F%A5%E8%AF%9D" data-section="一句话">/);
});

test("the scroll spy looks headings up by id, never by selector", () => {
  // 1249 headings in this KB start with a digit, and `#1-setup` is not a valid
  // CSS selector — querySelector would throw rather than miss.
  const html = layout(pageView({ sections: sections() }));
  assert.match(html, /document\.getElementById\(/);
  assert.doesNotMatch(html, /querySelector\("#"/);
});

test("the scroll spy's probe line clears the scroll margin by a pixel", () => {
  // A jump to #section scrolls to the heading's offset minus its 28px margin and
  // the browser snaps that to a whole pixel, so a heading on a fractional offset
  // settles a fraction *below* 28 — measured at 27.5–28.5 across one page's
  // headings. Probing at exactly 28 hands the highlight to the section above the
  // one the reader just clicked, on roughly half of them.
  const html = layout(pageView({ sections: sections() }));
  assert.match(html, /const line = 28 \+ 1;/);
});

test("issue #9: the Add note button waits for a drag-selection to end", () => {
  const html = layout(pageView({ notes: [] }));
  // Shown mid-drag, the pointer crossing it selected to the end of the page.
  assert.match(html, /document\.addEventListener\("selectionchange", \(\) => \{\n\s*if \(!dragging\) offerSelection\(\);/);
  assert.match(html, /document\.addEventListener\("mouseup", \(\) => \{\n\s*if \(!dragging\) return;\n\s*dragging = false;\n\s*offerSelection\(\);/);
});

test("headings get a scroll margin, and smooth scrolling stays off", () => {
  const html = layout(pageView());
  assert.match(html, /\.prose :is\(h1,h2,h3,h4,h5,h6\)\{scroll-margin-top:28px\}/);
  // Smooth scrolling would make scrollIntoView async, and NOTES_SCRIPT places a
  // popover against the rect the anchor lands at immediately afterwards.
  assert.doesNotMatch(html, /scroll-behavior/);
});

test("the section glyph is drawn by CSS so it stays out of the heading text", () => {
  assert.match(layout(pageView()), /\.section-link::before\{content:"#"\}/);
});

test("a real element id wins over the note-fragment handler", () => {
  const html = layout(pageView({ notes: [] }));
  assert.match(html, /if \(location\.hash\.length > 1 && document\.getElementById\(location\.hash\.slice\(1\)\)\) return;/);
});

test("the copy handler moves the address bar for a fragment control", () => {
  const html = layout(pageView());
  assert.match(html, /if \(href && href\.charAt\(0\) === "#"\) location\.hash = href\.slice\(1\);/);
});

test("Help documents section linking and the pin syntax", () => {
  const html = layout(pageView());
  assert.match(html, /Linking to a section/);
  assert.match(html, /\{#my-anchor\}/);
});

test("views: with sign-in off the corner keeps its tools but drops Log out", () => {
  const html = spacesLayout({ siteTitle: "KB", spaces: [], username: "" } as SpacesView);
  assert.match(html, /class="session-corner"/);
  assert.match(html, /data-help-open/);
  assert.match(html, /data-theme-toggle/);
  assert.doesNotMatch(html, /\/_logout/);

  const signedIn = spacesLayout({ siteTitle: "KB", spaces: [], username: "alice" } as SpacesView);
  assert.match(signedIn, /action="\/_logout"/);
});

test("views: every page with the corner carries a hidden update card that asks /_update", () => {
  for (const html of [
    spacesLayout({ siteTitle: "KB", spaces: [], username: "" } as SpacesView),
    layout(pageView()),
  ]) {
    assert.match(html, /<div class="update-card" data-update role="status" aria-live="polite" hidden><\/div>/);
    assert.match(html, /fetch\("\/_update"/);
    assert.doesNotMatch(html, /\.innerHTML\s*=\s*s\./, "server text never goes in as HTML");
  }
});

test("views: every page with the corner offers feedback, through /_feedback", () => {
  for (const html of [
    spacesLayout({ siteTitle: "KB", spaces: [], username: "" } as SpacesView),
    layout(pageView()),
  ]) {
    assert.match(html, /<button type="button" class="feedback-button" data-feedback-open aria-label="Send feedback"/);
    const script = html.slice(html.indexOf('<script type="module">'));
    assert.match(script, /import \{ mountFeedback \} from "\/_vendor\/feedback\/widget\/index\.js"/);
    assert.match(script, /app: "kb25"/);
    assert.match(script, /button: false/, "the corner's own button opens it");
    assert.match(script, /fetch\("\/_feedback"/);
    assert.match(script, /The last lines of KB25's log/);
    assert.doesNotMatch(html, /<dialog class="feedback-dialog"/, "the package draws the dialog now");
  }
});

/** Render with a launcher-started server's views, then put the default back. */
function asDesktop<T>(render: () => T): T {
  configureViews({ desktop: true });
  try {
    return render();
  } finally {
    configureViews({ desktop: false });
  }
}

test("views: a server started from a terminal offers no Quit", () => {
  for (const html of [
    spacesLayout({ siteTitle: "KB", spaces: [], username: "" } as SpacesView),
    layout(pageView()),
    loginLayout({ siteTitle: "KB", next: "/" } as LoginView),
  ]) {
    assert.doesNotMatch(html, /data-quit-open/);
    assert.doesNotMatch(html, /data-quit-dialog/);
    assert.doesNotMatch(html, /\/_quit/);
  }
});

test("views: a launcher-started server's corner offers Quit, behind a confirmation", () => {
  for (const html of asDesktop(() => [
    spacesLayout({ siteTitle: "KB", spaces: [], username: "" } as SpacesView),
    layout(pageView()),
  ])) {
    assert.match(html, /<button type="button" class="quit-button" data-quit-open aria-label="Quit KB25"/);
    assert.match(html, /<dialog class="help-dialog" data-quit-dialog>/);
    assert.match(html, /data-quit-confirm/);
    assert.match(html, /fetch\("\/_quit", \{ method: "POST" \}\)/);
  }
});

test("views: KB25's own window hides Quit and hands leaving links to the default browser", () => {
  const html = asDesktop(() => layout(pageView()));
  assert.match(html, /@media \(display-mode: standalone\)\{\.quit-button\{display:none\}\}/);
  // Only in the app window: a tab of the default browser is where links go.
  assert.match(html, /if \(!window\.matchMedia \|\| !matchMedia\("\(display-mode: standalone\)"\)\.matches\) return;/);
  assert.match(html, /if \(url\.origin === location\.origin && !newWindow\) return;/);
  assert.match(html, /fetch\("\/_open", \{/);
  // A server started from a terminal has no window to route for.
  assert.doesNotMatch(layout(pageView()), /\/_open/);
});

test("views: every page of a launcher-started server hears that KB25 quit, sign-in included", () => {
  for (const html of asDesktop(() => [
    spacesLayout({ siteTitle: "KB", spaces: [], username: "" } as SpacesView),
    layout(pageView()),
    loginLayout({ siteTitle: "KB", next: "/" } as LoginView),
  ])) {
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /channel\.addEventListener\("message", \(event\) => \{ if \(event\.data === "quit"\) showQuit\(\); \}\)/);
    // Nothing reports tabs open any more: KB25's window decides when it quits.
    assert.doesNotMatch(head, /_presence|navigator\.locks/);
  }
  // Signing in is still needed to quit.
  const login = asDesktop(() => loginLayout({ siteTitle: "KB", next: "/" } as LoginView));
  assert.doesNotMatch(login, /class="quit-button"/);
});

// --- labels ---------------------------------------------------------------

test("labels: labelsHref carries the space, every label and the query, encoded", () => {
  assert.equal(labelsHref("kb25"), "/_dashboard/labels?space=kb25");
  assert.equal(
    labelsHref("kb25", ["Needs review", "a&b"], "deploy x"),
    "/_dashboard/labels?space=kb25&label=Needs+review&label=a%26b&q=deploy+x"
  );
});

test("labels: every theme block defines every swatch", () => {
  const html = labelsDashboardLayout(labelsView());
  for (const color of ["gray", "red", "brown"]) {
    assert.equal(html.match(new RegExp(`--label-${color}-bg:`, "g"))?.length, 3, color);
    assert.match(html, new RegExp(`\\[data-label-color="${color}"\\]\\{--lc-bg:var\\(--label-${color}-bg\\)`));
  }
});

test("labels view: one GET form, a checkbox per known label, the selection ticked", () => {
  const html = labelsDashboardLayout(labelsView());
  assert.match(html, /<form class="label-filter" method="get" action="\/_dashboard\/labels" data-label-filter>/);
  assert.match(html, /<input type="hidden" name="space" value="kb25" \/>/);
  // Ticked case-insensitively: the URL said "draft", the palette says "Draft".
  assert.match(html, /name="label" value="Draft" checked \/>/);
  assert.match(html, /name="label" value="Needs review" \/>/);
  assert.match(html, /name="label" value="Legacy" \/>/);
  assert.match(html, /<span class="label-count">2<\/span>/);
  assert.match(html, /<input type="search" name="q" value=""/);
  assert.match(html, /<a class="label-clear" href="\/_dashboard\/labels\?space=kb25">Clear<\/a>/);
});

test("labels view: no Clear link when nothing is filtered", () => {
  const html = labelsDashboardLayout(labelsView({ selected: [], query: "" }));
  assert.doesNotMatch(html, /label-clear"/);
});

test("labels view: a chip takes its palette colour; an orphan is grey and dashed", () => {
  const html = labelsDashboardLayout(labelsView());
  assert.match(html, /<span class="label-chip" data-label-color="yellow">Draft<\/span>/);
  assert.match(
    html,
    /<span class="label-chip is-orphan" data-label-color="gray" title="Not in this space's label palette">Legacy<\/span>/
  );
});

test("labels view: each result links to its page, places it, and links its chips", () => {
  const html = labelsDashboardLayout(labelsView());
  assert.match(html, /<a class="label-result-title" href="\/kb25\/ops\/deploy">Deploy<\/a>/);
  assert.match(html, /<p class="task-crumb">Operations<\/p>/);
  assert.match(
    html,
    /<a class="label-chip" data-label-color="yellow" href="\/_dashboard\/labels\?space=kb25&amp;label=Draft">Draft<\/a>/
  );
  assert.match(html, /<p class="label-result-text">How we ship\.<\/p>/);
  assert.match(html, /<p class="label-results-count">1 page<\/p>/);
});

test("labels view: label names, query and result text are escaped", () => {
  const html = labelsDashboardLayout(
    labelsView({
      known: [{ name: "<i>x</i>", color: "gray", defined: false, count: 1 }],
      selected: [],
      query: '"><script>',
      results: [{ slug: "kb25/a", title: "<b>A</b>", labels: ["<i>x</i>"], text: "<img>" }],
    })
  );
  assert.doesNotMatch(html, /<i>x<\/i>|<b>A<\/b>|<img>|"><script>/);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;"/);
});

test("labels view: each empty state says why it is empty", () => {
  const none = labelsDashboardLayout(labelsView({ known: [], selected: [], results: [] }));
  assert.match(none, /No labels in <strong>KB25<\/strong> yet/);
  assert.doesNotMatch(none, /data-label-filter>/);

  const filtered = labelsDashboardLayout(labelsView({ results: [] }));
  assert.match(filtered, /No pages carry all of the selected labels\./);

  const searched = labelsDashboardLayout(labelsView({ results: [], query: "zzz" }));
  assert.match(searched, /No pages match “zzz” with these labels\./);

  const unlabelled = labelsDashboardLayout(labelsView({ results: [], selected: [] }));
  assert.match(unlabelled, /No pages carry a label yet\./);
});

test("labels view: ticking a label submits the form, and the page links back to the hub", () => {
  const html = labelsDashboardLayout(labelsView());
  assert.match(html, /form\.requestSubmit\(\)/);
  assert.match(html, /<a class="dash-back" href="\/_dashboard\?space=kb25">← Dashboards<\/a>/);
  assert.match(html, /<title>KB25 · Labels · KB<\/title>/);
});

/** The sidebar's <nav class="tree">, where the rows live. */
function sidebarTree(html: string): string {
  return html.match(/<nav class="tree">[\s\S]*?<\/nav>/)?.[0] ?? "";
}

test("labels: sidebar rows carry no label dots, while the rest of the label UI stays", () => {
  const html = layout(
    pageView({
      activeSlug: "kb25/deploy",
      labels: ["Draft"],
      tree: [node({ slug: "kb25/deploy", title: "Deploy", labels: ["Draft", "Legacy"] })],
      labelSet: [{ name: "Draft", color: "yellow" }],
    })
  );
  const tree = sidebarTree(html);
  assert.doesNotMatch(tree, /label-dot|tree-label-dots|Labels: /);
  // The row's ⋯ menu still opens the label dialog with the page's labels…
  assert.match(tree, /data-label-open data-label-slug="kb25\/deploy"[^>]*data-label-current="\[&quot;Draft&quot;,&quot;Legacy&quot;\]"/);
  // …the page header still shows them as chips, and search still filters by them.
  assert.match(html, /class="label-chip[^"]*" data-label-color="yellow"/);
  assert.match(html, /data-search-labels="[^"]*Draft/);
});

test("fresh: a page nobody has opened shows a glowing dot after its title", () => {
  const html = layout(
    pageView({ tree: [node({ slug: "kb25/a", title: "A", fresh: true }), node({ slug: "kb25/b", title: "B" })] })
  );
  const rows = sidebarTree(html).match(/<div class="tree-row">[\s\S]*?<details class="tree-menu">/g) ?? [];
  assert.equal(rows.length, 2);
  assert.match(rows[0], /A<\/a><span class="tree-fresh" role="img" aria-label="New, not opened yet" title="[^"]+"><\/span><details/);
  assert.doesNotMatch(rows[1], /tree-fresh/);
  // Still exactly one marker glyph at the head of the row.
  assert.equal([...rows[0].matchAll(/class="(tree-toggle|tree-toggle-spacer|tree-page-dot)"/g)].length, 1);
  // A steady glow: no animation anywhere on it.
  assert.match(html, /\.tree-fresh\{background:var\(--accent\); box-shadow:0 0 6px 1px var\(--fresh-glow\)\}/);
  assert.doesNotMatch(html, /\.tree-fresh[^{]*\{[^}]*animation/);
});

test("fresh: a group hiding a fresh page shows a ring, drawn only while it is shut", () => {
  const html = layout(
    pageView({
      activeSlug: "kb25/notes",
      tree: [
        node({
          slug: "kb25/research",
          title: "Research",
          isSection: true,
          children: [
            node({
              slug: "kb25/research/topics",
              title: "Topics",
              isSection: true,
              children: [node({ slug: "kb25/research/topics/new", title: "New", fresh: true })],
            }),
          ],
        }),
        node({
          slug: "kb25/ideas",
          title: "Ideas",
          isSection: true,
          fresh: true,
          children: [node({ slug: "kb25/ideas/one", title: "One", fresh: true })],
        }),
        node({ slug: "kb25/notes", title: "Notes" }),
      ],
    })
  );
  const row = (slug: string) =>
    html.match(new RegExp(`<li data-tree-slug="${slug.replace(/\//g, "\\/")}"[^>]*><div class="tree-row">[\\s\\S]*?<details`))?.[0] ?? "";
  // Every ancestor of the fresh page carries the ring, however deep.
  assert.match(row("kb25/research"), /<span class="tree-fresh-within" role="img" aria-label="Contains new pages"/);
  assert.match(row("kb25/research/topics"), /tree-fresh-within/);
  assert.match(row("kb25/research/topics/new"), /class="tree-fresh"/);
  // A fresh group shows its own dot, never the ring as well.
  assert.match(row("kb25/ideas"), /class="tree-fresh"/);
  assert.doesNotMatch(row("kb25/ideas"), /tree-fresh-within/);
  assert.doesNotMatch(row("kb25/notes"), /tree-fresh/);
  // CSS, not script, hides the ring once its group is open.
  assert.match(html, /\.tree-fresh-within\{display:none;/);
  assert.match(html, /\.tree li\.collapsed > \.tree-row > \.tree-fresh-within\{display:block\}/);
});

test("fresh: the archive tree never shows the mark", () => {
  const html = layout(
    pageView({ isArchiveView: true, tree: [node({ slug: "kb25/a", title: "A", archived: true, fresh: true })] })
  );
  assert.doesNotMatch(sidebarTree(html), /tree-fresh/);
});

test("labels: the page header shows its labels as chips linking to the Labels view", () => {
  const html = layout(
    pageView({
      labels: ["Draft", "Needs review"],
      labelSet: [{ name: "Draft", color: "yellow" }, { name: "Needs review", color: "orange" }],
      tags: ["ops"],
    })
  );
  assert.match(
    html,
    /<div class="meta"><div class="page-labels"><span class="label-chips"><a class="label-chip" data-label-color="yellow" href="\/_dashboard\/labels\?space=kb25&amp;label=Draft">Draft<\/a><a class="label-chip" data-label-color="orange" href="\/_dashboard\/labels\?space=kb25&amp;label=Needs\+review">Needs review<\/a><\/span><\/div><div class="tags">/
  );
});

test("labels: a page without labels has no label row in its header", () => {
  const html = layout(pageView({ tags: ["ops"] }));
  assert.doesNotMatch(html, /class="page-labels"/);
});

test("labels: every sidebar-drawing layout passes the palette to the tree", () => {
  const tree = [node({ slug: "kb25/a", title: "A", labels: ["Draft"] })];
  const labelSet = [{ name: "Draft", color: "red" as const }];
  const dot = /<span class="label-dot" data-label-color="red">/;
  assert.match(layout(pageView({ tree, labelSet })), dot);
  assert.match(folderLayout({ ...pageView({ tree, labelSet }), children: [] } as unknown as FolderView), dot);
  assert.match(editLayout(editView({ tree, labelSet })), dot);
  assert.match(dashboardLayout(dashboardView({ tree, labelSet })), dot);
  assert.match(dashboardsLayout(dashboardsView({ tree, labelSet })), dot);
  assert.match(labelsDashboardLayout(labelsView({ tree, labelSet })), dot);
});

test("label dialog: a page's ⋯ menu opens it with the page and its labels", () => {
  const html = layout(
    pageView({ tree: [node({ slug: "kb25/deploy", title: "Deploy", labels: ["Draft"] })] })
  );
  assert.match(
    html,
    /<button type="button" data-label-open data-label-slug="kb25\/deploy" data-label-title="Deploy" data-label-current="\[&quot;Draft&quot;\]">Labels<\/button>/
  );
});

test("label dialog: folders get no Labels item", () => {
  const html = layout(
    pageView({ tree: [node({ slug: "kb25/box", title: "Box", isFolder: true, isSection: true })] })
  );
  assert.doesNotMatch(html, /<button type="button" data-label-open/);
});

test("label dialog: one dialog per sidebar, carrying the palette plus orphans", () => {
  const html = layout(
    pageView({
      tree: [node({ slug: "kb25/a", title: "A", labels: ["Legacy"] })],
      labelSet: [{ name: "Draft", color: "yellow" }],
    })
  );
  assert.equal(html.match(/<dialog class="label-dialog"/g)?.length, 1);
  assert.match(
    html,
    /data-label-palette="\[\{&quot;name&quot;:&quot;Draft&quot;,&quot;color&quot;:&quot;yellow&quot;,&quot;defined&quot;:true\},\{&quot;name&quot;:&quot;Legacy&quot;,&quot;color&quot;:&quot;gray&quot;,&quot;defined&quot;:false\}\]"/
  );
  assert.match(html, /<form class="label-dialog-form" method="post" action="\/_labels\/page">/);
  assert.match(html, /<input type="radio" name="newColor" value="gray" checked \/>/);
  assert.equal(html.match(/name="newColor"/g)?.length, 10);
});

test("label dialog: a palette name cannot break out of its attribute", () => {
  const html = layout(pageView({ labelSet: [{ name: '"><script>x</script>', color: "red" }] }));
  assert.doesNotMatch(html, /"><script>x<\/script>/);
});

test("label dialog: absent outside a space and in the archive browser", () => {
  const outside = layout(pageView({ spaceKey: "" }));
  assert.doesNotMatch(outside, /<dialog class="label-dialog"/);
  const archive = layout(pageView({ isArchiveView: true }));
  assert.doesNotMatch(archive, /<dialog class="label-dialog"/);
});

test("label dialog: its script builds rows without markup strings", () => {
  const html = layout(pageView());
  const script = html.match(/var dialog = document\.querySelector\("\[data-label-dialog\]"\);[\s\S]*?\}\)\(\);/)?.[0] ?? "";
  assert.ok(script, "label dialog script is present");
  assert.match(script, /document\.createElement\("input"\)/);
  assert.match(script, /span\.textContent = entry\.name/);
  assert.match(script, /returnInput\.value = location\.pathname \+ location\.search/);
});

test("Help mentions labels and where to find them", () => {
  const html = layout(pageView());
  assert.match(html, /download, label, copy its link/);
  assert.match(html, /<strong>Dashboards<\/strong> button in the corner lists and searches pages by label/);
});

test("manage labels: a create form, then one row per label with rename, colour and delete", () => {
  const html = labelsDashboardLayout(labelsView());
  assert.match(html, /<section class="label-manage" id="manage-labels">/);
  assert.match(html, /<form class="label-manage-form label-create" method="post" action="\/_labels\/create">/);
  assert.match(html, /<input type="text" name="name" maxlength="40" required placeholder="New label"/);

  const rows = html.match(/<li class="label-manage-row">[\s\S]*?<\/li>/g) ?? [];
  assert.equal(rows.length, 3);
  const draft = rows[0];
  assert.match(draft, /action="\/_labels\/update"/);
  assert.match(draft, /<input type="hidden" name="name" value="Draft" \/>/);
  assert.match(draft, /<input type="text" name="newName" value="Draft"/);
  // The current colour is the checked swatch.
  assert.match(draft, /name="newColor" value="yellow" checked/);
  assert.equal(draft.match(/ checked/g)?.length, 1);
  assert.match(draft, /<form method="post" action="\/_labels\/delete">/);
  assert.match(draft, /from every page carrying it — 2 pages here, plus any archived ones\./);
});

test("manage labels: names are escaped in every form field", () => {
  const html = labelsDashboardLayout(
    labelsView({ known: [{ name: '"><b>x', color: "gray", defined: false, count: 1 }] })
  );
  assert.doesNotMatch(html, /"><b>x/);
  assert.match(html, /value="&quot;&gt;&lt;b&gt;x"/);
});

test("manage labels: the dialog links straight to the management section", () => {
  const html = layout(pageView());
  assert.match(
    html,
    /<a class="label-dialog-manage" href="\/_dashboard\/labels\?space=kb25#manage-labels">Manage labels<\/a>/
  );
});

test("search filter: the box carries the labels on offer, and its controls start hidden", () => {
  const html = layout(
    pageView({
      tree: [node({ slug: "kb25/a", title: "A", labels: ["Legacy"] })],
      labelSet: [{ name: "Draft", color: "yellow" }],
    })
  );
  assert.match(
    html,
    /<div class="sidebar-search" data-search data-search-space="kb25" data-search-labels="\[\{&quot;name&quot;:&quot;Draft&quot;,&quot;color&quot;:&quot;yellow&quot;,&quot;defined&quot;:true\},\{&quot;name&quot;:&quot;Legacy&quot;/
  );
  // Revealed by the script, and only when there is a label to pick.
  assert.match(html, /<button type="button" class="sidebar-search-filter" data-search-filter hidden/);
  assert.match(html, /<div id="kb-search-picker" class="sidebar-search-picker" role="group" aria-label="Filter by label" data-search-picker hidden><\/div>/);
  assert.match(html, /<a class="sidebar-search-more" data-search-more href="\/_dashboard\/labels\?space=kb25" hidden>Show all results<\/a>/);
});

test("search filter: requests carry the labels and stale answers are keyed on them too", () => {
  const html = layout(pageView());
  assert.match(html, /selected\.map\(\(name\) => "&label=" \+ encodeURIComponent\(name\)\)\.join\(""\)/);
  assert.match(html, /return JSON\.stringify\(\[query, selected\]\);/);
  assert.match(html, /if \(key !== lastKey\) return;/);
  assert.match(html, /cache\.set\(key, result\);/);
  assert.doesNotMatch(html, /lastQuery/);
});

test("search filter: the picked labels are kept per space for the tab", () => {
  const html = layout(pageView());
  assert.match(html, /const STORE_KEY = "kb:search-labels:" \+ space;/);
  assert.match(html, /sessionStorage\.setItem\(STORE_KEY, JSON\.stringify\(selected\)\)/);
});

test("search filter: a chip that removes itself on click does not count as an outside click", () => {
  const html = layout(pageView());
  assert.match(html, /if \(event\.composedPath\(\)\.includes\(root\)\) return;/);
});

// --- folder dialog ----------------------------------------------------------

test("folder dialog: no menu carries a bare name box any more", () => {
  const html = layout(
    pageView({
      tree: [
        node({ slug: "kb25/box", title: "Box", isSection: true, isFolder: true }),
        node({ slug: "kb25/guide", title: "Guide" }),
      ],
    })
  );
  assert.doesNotMatch(html, /placeholder="Folder name"/);
  // The one name field on the page is the dialog's.
  assert.equal(html.match(/<input[^>]*name="name"/g)?.length, 1);
});

test("folder dialog: one per sidebar, a labelled name field and both hidden targets", () => {
  const html = layout(pageView());
  assert.equal(html.match(/<dialog class="folder-dialog"/g)?.length, 1);
  assert.match(html, /<form class="label-dialog-form" method="post" action="\/_create-folder" data-folder-form novalidate>/);
  assert.match(html, /<label class="folder-dialog-label" for="folder-dialog-name">Name<\/label>/);
  assert.match(html, /<input id="folder-dialog-name" class="folder-dialog-input" type="text" name="name"/);
  assert.match(html, /<input type="hidden" name="parentSlug" value="" data-folder-parent-field \/>/);
  // Create is the starting mode, so the rename target is not sent.
  assert.match(html, /<input type="hidden" name="slug" value="" data-folder-slug-field disabled \/>/);
  assert.match(html, /<p id="folder-dialog-error" class="folder-dialog-error" role="alert" data-folder-error hidden><\/p>/);
  assert.match(html, /<button type="submit" class="button primary" data-folder-submit>Create folder<\/button>/);
});

test("folder dialog: absent outside a space and in the archive browser", () => {
  assert.doesNotMatch(layout(pageView({ spaceKey: "" })), /<dialog class="folder-dialog"/);
  assert.doesNotMatch(layout(pageView({ isArchiveView: true })), /<dialog class="folder-dialog"/);
});

test("folder dialog: its script switches modes and mirrors the server's name rule", () => {
  const html = layout(pageView());
  assert.match(html, /form\.action = "\/_create-folder";/);
  assert.match(html, /form\.action = "\/_rename-folder";/);
  assert.match(html, /parentField\.disabled = true;\s*parentField\.value = "";\s*slugField\.disabled = false;/);
  // The server builds the address from ASCII letters and digits only.
  assert.match(html, /if \(!\/\[a-z0-9\]\/i\.test\(name\)\)/);
  assert.match(html, /submit\.disabled = !name \|\| \(mode === "rename" && name === original\);/);
});

test("folder dialog: a folder title is escaped into the button that opens it", () => {
  const html = layout(
    pageView({
      tree: [node({ slug: "kb25/box", title: '"><b>x', isSection: true, isFolder: true })],
    })
  );
  assert.match(html, /data-folder-title="&quot;&gt;&lt;b&gt;x"/);
  assert.match(html, /data-folder-parent-title="&quot;&gt;&lt;b&gt;x"/);
});

test("views: every page with the corner has the chat, told which page is open", () => {
  const cases: Array<[string, string]> = [
    [layout(pageView({ activeSlug: "kb25/notes" })), "kb25/notes"],
    [folderLayout(folderView()), "kb25/box"],
    [editLayout(editView()), editView().activeSlug],
    [spacesLayout(spacesView()), ""],
  ];
  for (const [html, slug] of cases) {
    assert.match(html, /<button type="button" class="chat-button" data-chat-open aria-expanded="false" aria-label="Chat"/);
    assert.match(html, new RegExp(`<section class="chat-drawer" data-chat data-chat-slug="${slug}" aria-label="Chat" hidden>`));
    assert.match(html, /data-chat-pages \/> Write to KB/);
  }
  assert.doesNotMatch(loginLayout({ siteTitle: "KB", next: "/" } as LoginView), /data-chat/);
});

test("views: the page the chat is told about is escaped into its attribute", () => {
  const html = layout(pageView({ activeSlug: 'kb25/"><b>x' }));
  assert.match(html, /data-chat-slug="kb25\/&quot;&gt;&lt;b&gt;x"/);
});

test("views: the chat posts to its thread and follows the turn's event stream", () => {
  const html = layout(pageView());
  const script = html.slice(html.indexOf('const drawer = document.querySelector("[data-chat]")'));
  assert.match(script, /fetch\("\/_chat\/threads\/" \+ threadId \+ "\/messages"/);
  assert.match(script, /JSON\.stringify\(\{\s*text,\s*forcePages: pages\.checked,\s*slug,\s*engine: threadEngine \? undefined : engine,/);
  assert.match(script, /new EventSource\("\/_chat\/threads\/" \+ threadId \+ "\/events"\)/);
  assert.match(script, /"\/_chat\/status" \+ \(fresh \? "\?fresh=1" : ""\)/);
  // The report links every page the turn wrote, and server text stays text.
  assert.match(script, /link\.href = change\.href/);
  assert.match(script, /new DOMParser\(\)\.parseFromString\(message\.html, "text\/html"\)/);
  // Open/closed and the Write to KB toggle survive the page loads between them.
  assert.match(script, /localStorage\.setItem\("kb25\.chat\." \+ key, value\)/);
});

test("views: the chat offers Claude or Codex for a new chat and names a thread's engine", () => {
  const html = layout(pageView());
  assert.match(html, /<div class="chat-engines" data-chat-engines role="radiogroup" aria-label="Run this chat on" hidden><\/div>/);
  assert.match(html, /<span class="chat-engine" data-chat-engine hidden><\/span>/);
  const script = html.slice(html.indexOf('const drawer = document.querySelector("[data-chat]")'));
  // The switch only when two engines are ready and the chat has not begun.
  assert.match(script, /enginePicker\.hidden = !\(both && !threadEngine\)/);
  assert.match(script, /saved\.set\("engine", engine\.id\)/);
  // Setup help covers both programs.
  assert.match(script, /codex: \{ url: "https:\/\/github\.com\/openai\/codex", login: "codex login", update: "codex update" \}/);
});

test("views: the chat picks a model and effort from what the engine listed, per engine", () => {
  const html = layout(pageView());
  // A row of their own, hidden until the engine has said what it offers.
  assert.match(
    html,
    /<div class="chat-form-row chat-run" data-chat-run hidden>\s*<select class="chat-select" data-chat-model aria-label="Model"[^>]*><\/select>\s*<select class="chat-select" data-chat-effort aria-label="Effort"[^>]*><\/select>\s*<\/div>/
  );
  const script = html.slice(html.indexOf('const drawer = document.querySelector("[data-chat]")'));
  assert.match(script, /runRow\.hidden = !models/);
  // Only the engine's own models, no Default: the last pick, else what it starts on.
  assert.match(script, /modelPicker\.replaceChildren\(\.\.\.models\.map\(\(m\) => option\(m\.id, m\.name\)\)\)/);
  assert.match(script, /models\.find\(\(m\) => m\.id === saved\.get\("model\." \+ engine\.id\)\) \|\|\s*models\.find\(\(m\) => m\.id === engine\.start\.model\)/);
  assert.match(script, /saved\.set\("model\." \+ \(threadEngine \|\| chosenEngine\(\)\), modelPicker\.value \|\| null\)/);
  assert.match(script, /saved\.set\("effort\." \+ \(threadEngine \|\| chosenEngine\(\)\), effortPicker\.value \|\| null\)/);
  // Only efforts the model takes, the last pick first; none shown for a model that takes none.
  assert.match(script, /const wanted = \[saved\.get\("effort\." \+ engine\.id\), engine\.start\.effort, "high"\]/);
  assert.match(script, /effortPicker\.hidden = !efforts\.length/);
  assert.doesNotMatch(script, /Default (model|effort)/);
  assert.match(script, /model: modelPicker\.value \|\| undefined,\s*effort: effortPicker\.value \|\| undefined,/);
});
