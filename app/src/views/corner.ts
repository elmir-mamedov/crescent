import { CHAT_BUTTON, CHAT_SCRIPT, chatDrawer } from "./chat.js";
import { changeCursor, desktop } from "./config.js";
import { dashboardsHref, escapeHtml, galleryHref } from "./html.js";

/**
 * The tools pinned to the top-right corner of every page past sign-in (chat,
 * gallery, space instructions, dashboards, theme, feedback, help, Quit and the
 * session), their dialogs and scripts, and the cards that say an update is out or
 * that the KB changed under the page.
 */

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
export function themeToggle(): string {
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle dark mode" title="Toggle dark mode">
    <svg class="theme-icon icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
    <svg class="theme-icon icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
  </button>`;
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
export function sessionCorner(username?: string | null, spaceKey = "", chatSlug = "", follow = true): string {
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

/** Help dialog content: a short KB25 overview plus the keyboard shortcuts. */
const HELP_DIALOG = `<dialog class="help-dialog" data-help-dialog tabindex="-1">
  <form method="dialog" class="help-head">
    <h2>Crescent Help</h2>
    <button class="help-close" aria-label="Close help" value="close">&times;</button>
  </form>
  <section class="help-section">
    <h3>About Crescent</h3>
    <p>Crescent is a lean Markdown knowledge base. Content is organized into <strong>spaces</strong> &mdash; the top-level containers shown on the home page &mdash; and each space holds a tree of pages in the sidebar. Open any page and press <strong>Edit</strong> to change its Markdown; every save is committed to Git automatically. Drag pages in the sidebar to re-organize them: drop a page <em>onto</em> another one to nest it inside, or onto the line that appears <em>between</em> two pages to put it there &mdash; including the line at the top level, which lifts a child page back out to the space root. To keep several pages open at once, <kbd>&#8984;</kbd>/<kbd>Ctrl</kbd>-click a page in the sidebar, or any link to one: each opens in a <strong>tab</strong> along the top, and the button at its left end closes all but the one you are on. The arrows at the top left go back and forward between the pages you have opened, as in a browser. A page in a tab, like each of the last few pages you read, opens again where you left it. Use the <strong>&ctdot;</strong> menu next to a page to add a child, edit, download, label, copy its link, or delete it. <strong>Labels</strong> are coloured markers such as &ldquo;Draft&rdquo; or &ldquo;Needs review&rdquo;; they show as chips at the top of a page, and the <strong>Dashboards</strong> button in the corner lists and searches pages by label. The <strong>Gallery</strong> button beside the chat shows every image in the space and uploads new ones; to put one on a page, write <code>![](_assets/name.png)</code> in the page's Markdown. A glowing blue dot beside a page in the sidebar means it is new and has not been opened yet, whether an agent or a person added it; a ring on a closed group means such a page is inside. Opening the page clears it. <strong>Folders</strong> are pure containers &mdash; they hold pages and other folders but have no content of their own, so you rename them instead of editing them.</p>
  </section>
  <section class="help-section">
    <h3>Keyboard shortcuts</h3>
    <dl class="help-keys">
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd></dt>
      <dd>Search this space from the sidebar</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>F</kbd></dt>
      <dd>Find text on the page you are viewing and in its On this page list; <kbd>Enter</kbd> and <kbd>Shift</kbd> + <kbd>Enter</kbd> go to the next and previous match</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>E</kbd></dt>
      <dd>Edit the page you are viewing</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>S</kbd></dt>
      <dd>Save the page you are editing</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd></dt>
      <dd>Copy this page's relative link (space/&hellip;/page)</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + click</dt>
      <dd>Open a page in a new tab, from the sidebar or any link to it</dd>
      <dt><kbd>&#8984;</kbd> / <kbd>Ctrl</kbd> + <kbd>W</kbd></dt>
      <dd>Close the tab you are on, when more than one is open</dd>
      <dt><kbd>Shift</kbd> + click</dt>
      <dd>Select a page in the sidebar; Shift-click another to select both and every page between them, then drag them together</dd>
      <dt><kbd>Esc</kbd></dt>
      <dd>Close the search results, the find bar or this dialog</dd>
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
// The dialog opens whole (feedback #25). Opened before GET /_feedback had
// answered, it showed without the logs row and with half its details, then
// grew as they came, and being centred, jumped up the screen; it did so on
// the first opening on every page, since later ones keep what they loaded.
// So the answer is asked for as the pointer comes to the button, and waited
// for, a moment at most, on the click.
const WAIT = 400;
document.querySelectorAll("[data-feedback-open]").forEach((button) => {
  button.addEventListener("pointerenter", () => void info());
  button.addEventListener("focus", () => void info());
  button.addEventListener("click", async () => {
    await Promise.race([info(), new Promise((resolve) => setTimeout(resolve, WAIT))]);
    feedback.open();
  });
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
