import type { SpaceInfo } from "../content.js";
import { sessionCorner } from "./corner.js";
import { renderHead } from "./head.js";
import { escapeHtml, slugPath } from "./html.js";
import type { ViewNotice } from "./page.js";
import { tabStrip } from "./tabs.js";

/**
 * The Spaces page: a card per space with its menu, and the confirmation before a
 * space is deleted.
 */

export interface SpacesView {
  siteTitle: string;
  spaces: SpaceInfo[];
  notice?: ViewNotice;
  username?: string | null;
  /** When set, show a delete-space confirmation for this space above the grid. */
  confirmDelete?: { key: string; title: string };
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
  const card = (s: SpaceInfo): string => {
    const icon = s.icon
      ? `<span class="space-icon">${escapeHtml(s.icon)}</span>`
      : "";
    const summary = s.summary
      ? `<p class="space-summary">${escapeHtml(s.summary)}</p>`
      : "";
    // The card link cannot contain the interactive ⋯ menu (no nested
    // forms/anchors), so wrap both and float the menu into the corner.
    return `<div class="space-card-wrap${s.archived ? " is-archived" : ""}">
    <a class="space-card" href="${slugPath(s.key)}">
      ${icon}
      <span class="space-card-title">${escapeHtml(s.title)}</span>
      ${summary}
    </a>
    ${spaceMenu(s)}
  </div>`;
  };
  const live = v.spaces.filter((s) => !s.archived);
  const archived = v.spaces.filter((s) => s.archived);
  const cards = live.length
    ? live.map(card).join("")
    : `<p class="empty">No spaces yet — create your first one below.</p>`;
  // An archived space is out of the way, not gone: it waits here, apart from
  // the rest, until it is restored. Only drawn while there is one.
  const archivedSection = archived.length
    ? `
  <section class="spaces-archived" aria-labelledby="spaces-archived-head">
    <h2 id="spaces-archived-head">Archived spaces</h2>
    <div class="spaces-grid">${archived.map(card).join("")}</div>
  </section>`
    : "";

  return `<!doctype html>
<html lang="en">
${renderHead(`Spaces · ${escapeHtml(v.siteTitle)}`)}
<body class="spaces-page">
${sessionCorner(v.username)}
${tabStrip("Spaces")}
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
  </div>${archivedSection}
</main>
<script>${SPACE_MENU_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Per-space ⋯ menu on the home grid: edit the space's display name (an inline
 * rename, the space's key/URL stays put), archive the whole space, or delete it
 * outright. Mirrors the sidebar page menu, but scoped to space-level actions.
 * An archived space offers Restore in place of Archive and Rename.
 */
function spaceMenu(space: SpaceInfo): string {
  const key = space.key;
  const middle = space.archived
    ? `<form method="post" action="/_restore${slugPath(key)}">
        <button type="submit">Restore</button>
      </form>`
    : `<form class="menu-name-form" method="post" action="/_rename-space">
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <input type="text" name="title" value="${escapeHtml(space.title)}" aria-label="Space name" required />
        <button type="submit">Rename</button>
      </form>
      <form method="post" action="/_archive-space">
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <button type="submit">Archive</button>
      </form>`;
  return `<details class="space-menu">
    <summary aria-label="Space actions">⋯</summary>
    <div class="space-menu-pop">
      ${middle}
      <a href="/_delete-space${slugPath(key)}">Delete</a>
    </div>
  </details>`;
}

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
