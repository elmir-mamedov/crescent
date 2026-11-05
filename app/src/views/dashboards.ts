import type { PageNode, SpaceInfo } from "../content.js";
import { labelKey } from "../frontmatter.js";
import type { KnownLabel, LabelDef } from "../labels.js";
import { relativeAge, type NotePageGroup, type NoteSummary } from "../note-index.js";
import { dashboardsHref, escapeHtml, labelsHref, slugPath } from "./html.js";
import { labelChip, labelChips, labelColorPicker, labelSwatches } from "./labels.js";
import { layout, type ViewNotice } from "./page.js";

/**
 * The Dashboards hub, the open-tasks dashboard, and the Labels view.
 */

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
          ${labelColorPicker(label.name, label.color)}
          <button class="button secondary" type="submit">Save</button>
        </form>
        <button type="button" class="button danger label-delete" data-label-delete data-label-name="${name}" data-label-pages="${pages}">Delete</button>
      </li>`;
    })
    .join("\n      ");
  // One dialog for every row's Delete (feedback #36): it asks, and deletes.
  // LABEL_MANAGE_SCRIPT puts the row's label in it before it opens.
  const deleteDialog = v.known.length
    ? `<dialog class="label-dialog label-delete-dialog" data-label-delete-dialog tabindex="-1" aria-labelledby="label-delete-title">
    <form class="label-dialog-form" method="post" action="/_labels/delete">
      <div class="help-head">
        <h2 id="label-delete-title">Delete label?</h2>
        <button type="button" class="help-close" data-label-delete-close aria-label="Close">&times;</button>
      </div>
      <div class="label-delete-body">
        <p data-label-delete-text></p>
      </div>
      ${spaceField}
      <input type="hidden" name="name" value="" data-label-delete-name />
      <div class="label-dialog-actions">
        <button type="button" class="button secondary" data-label-delete-close>Cancel</button>
        <button type="submit" class="button danger">Delete</button>
      </div>
    </form>
  </dialog>`
    : "";
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
  </section>
  ${deleteDialog}`;

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
<script>${LABEL_FILTER_SCRIPT}</script>
<script>${LABEL_MANAGE_SCRIPT}</script>`,
    canEdit: false,
    username: v.username,
  });
}

/** Two stacked sheets: the copy affordance on the dashboard's note-id buttons. */
const COPY_GLYPH = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>`;

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
 * The colour pickers in Manage labels (labelColorPicker). A colour picked
 * shows on the row's dot at once and is saved with the row's Save. A click
 * folds the palette away; the arrow keys leave it open, since they step
 * through it. One palette is open at a time, and a click elsewhere or Esc
 * folds it.
 */
const LABEL_MANAGE_SCRIPT = `
(() => {
  // A row's Delete asks first, in a dialog naming the label and the pages it
  // comes off; the dialog's Delete posts the delete.
  const confirmDelete = document.querySelector("[data-label-delete-dialog]");
  if (confirmDelete && typeof confirmDelete.showModal === "function") {
    const field = confirmDelete.querySelector("[data-label-delete-name]");
    const text = confirmDelete.querySelector("[data-label-delete-text]");
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-label-delete]") : null;
      if (!button) return;
      const name = button.getAttribute("data-label-name") || "";
      field.value = name;
      text.textContent =
        "\\u201c" + name + "\\u201d comes off the palette and off every page carrying it \\u2014 " +
        (button.getAttribute("data-label-pages") || "") + " here, plus any archived ones.";
      confirmDelete.showModal();
      // Not its close button, which would wear a focus ring until clicked away.
      confirmDelete.focus();
    });
    for (const close of confirmDelete.querySelectorAll("[data-label-delete-close]")) {
      close.addEventListener("click", () => confirmDelete.close());
    }
    // A click on the backdrop lands on the dialog itself.
    confirmDelete.addEventListener("click", (event) => {
      if (event.target === confirmDelete) confirmDelete.close();
    });
  }

  const picks = Array.from(document.querySelectorAll("[data-label-color-pick]"));
  if (!picks.length) return;
  for (const pick of picks) {
    let pointer = false;
    pick.addEventListener("toggle", () => {
      if (!pick.open) return;
      for (const other of picks) if (other !== pick) other.open = false;
    });
    pick.addEventListener("pointerdown", () => {
      pointer = true;
    });
    pick.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "radio") return;
      const dot = pick.querySelector("[data-label-color-dot]");
      const name = pick.querySelector("[data-label-color-name]");
      if (dot) dot.setAttribute("data-label-color", input.value);
      if (name) name.textContent = input.value;
      if (pointer) pick.open = false;
      pointer = false;
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Node ? event.target : null;
    for (const pick of picks) if (pick.open && !(target && pick.contains(target))) pick.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = picks.find((pick) => pick.open);
    if (!open) return;
    open.open = false;
    const summary = open.querySelector("summary");
    if (summary) summary.focus();
  });
})();
`;
