import { escapeHtml } from "./html.js";

/**
 * Making and renaming folders: the buttons, the dialog they open, and its script.
 */

/**
 * Opens the folder dialog to create a folder inside `parentSlug`. The parent's
 * title rides along so the dialog can say where the folder will land.
 */
export function newFolderButton(parentSlug: string, parentTitle: string, text: string, cls = ""): string {
  return `<button type="button"${cls ? ` class="${cls}"` : ""} data-folder-new data-folder-parent="${escapeHtml(parentSlug)}" data-folder-parent-title="${escapeHtml(parentTitle)}">${escapeHtml(text)}</button>`;
}

/** Opens the folder dialog to rename the folder at `slug`, prefilled with its title. */
export function renameFolderButton(slug: string, title: string, text: string, cls = ""): string {
  return `<button type="button"${cls ? ` class="${cls}"` : ""} data-folder-rename data-folder-slug="${escapeHtml(slug)}" data-folder-title="${escapeHtml(title)}">${escapeHtml(text)}</button>`;
}

/**
 * The folder dialog, shared by every way of making or renaming a folder: the
 * sidebar's Create menu, a row's ⋯ menu and the folder page's own buttons.
 * FOLDER_DIALOG_SCRIPT switches it between creating (posts to /_create-folder
 * with the parent) and renaming (posts to /_rename-folder with the folder);
 * whichever hidden field the mode does not use is disabled, so it is not sent.
 */
export function folderDialog(): string {
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
