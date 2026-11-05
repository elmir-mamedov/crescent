import type { PageNode, SpaceInfo } from "../content.js";
import type { LabelDef } from "../labels.js";
import { sessionCorner } from "./corner.js";
import { renderHead } from "./head.js";
import { escapeHtml, slugPath } from "./html.js";
import { COPY_LINK_SCRIPT, breadcrumb, layout } from "./page.js";
import { SIDEBAR_RENDER_HOLD, sidebarHtml } from "./sidebar.js";
import { tabStrip } from "./tabs.js";
import { MOVE_SCRIPT } from "./tree.js";

/**
 * Editing a page, and confirming that it should be deleted.
 */

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
${tabStrip(`Edit ${v.title}`, { scrollMemory: false })}
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
