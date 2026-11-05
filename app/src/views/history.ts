import type { PageNode, SpaceInfo } from "../content.js";
import type { DiffLine } from "../diff.js";
import type { LabelDef } from "../labels.js";
import { sessionCorner } from "./corner.js";
import { renderHead } from "./head.js";
import { escapeHtml, slugPath } from "./html.js";
import { COPY_LINK_SCRIPT, breadcrumb } from "./page.js";
import { SIDEBAR_RENDER_HOLD, sidebarHtml } from "./sidebar.js";
import { tabStrip } from "./tabs.js";
import { MOVE_SCRIPT } from "./tree.js";

/**
 * A page's history: one saved revision at a time, as a word diff, with who made
 * it.
 */

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
${tabStrip(`History ${v.title}`)}
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
