import { labelKey } from "../frontmatter.js";
import {
  LABEL_COLORS,
  colorOf,
  type KnownLabel,
  type LabelColor,
  type LabelDef,
} from "../labels.js";
import { escapeHtml, labelsHref } from "./html.js";

/**
 * Labels on pages: the chips under a page's title, the colour swatches, and the
 * dialog that sets a page's labels from the sidebar.
 */

/**
 * The palette as a row of colour radios, one checked. Radio groups are scoped
 * to their form, so several forms on one page can share the field name.
 */
export function labelSwatches(name: string, checked: LabelColor, label = "Colour"): string {
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
 * A label's colour on its row in Manage labels: the colour it has, as one dot
 * that opens the palette beneath it (feedback #35). A whole palette on every
 * row made the list a wall of dots. It is a <details>, so it opens with
 * scripts off, and its radios go with the row's form whether it is open or
 * not; LABEL_MANAGE_SCRIPT shows a picked colour on the dot and folds it away.
 */
export function labelColorPicker(name: string, color: LabelColor): string {
  return `<details class="label-color-pick" data-label-color-pick>
            <summary class="label-color-current" title="Change colour"><span class="label-dot" data-label-color="${color}" data-label-color-dot></span><span class="sr-only">Colour: <span data-label-color-name>${color}</span></span><svg class="label-color-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></summary>
            <div class="label-color-pop">${labelSwatches("newColor", color, `Colour for ${name}`)}</div>
          </details>`;
}

/**
 * The one label dialog a sidebar shares across all its rows. Each row's
 * "Labels" item carries its page and current labels; LABELS_SCRIPT fills the
 * checkbox list from those and from the palette here, then the dialog posts a
 * plain form. Shipping the palette once beats a checkbox list in every row's
 * menu, which would repeat it for every page in the tree.
 */
export function labelDialog(spaceKey: string, offered: readonly OfferedLabel[]): string {
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
export type OfferedLabel = Pick<KnownLabel, "name" | "color" | "defined">;

/**
 * One label as a pill. A label the palette does not define gets a dashed edge,
 * so it reads as "carried, but not set up" rather than as a deliberate grey.
 */
export function labelChip(
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
export function labelChips(names: readonly string[], set: readonly LabelDef[], spaceKey: string): string {
  if (!names.length) return "";
  return `<span class="label-chips">${names
    .map((name) => labelChip(name, set, labelsHref(spaceKey, [name])))
    .join("")}</span>`;
}

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
