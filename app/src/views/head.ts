import { desktop } from "./config.js";
import { STYLES } from "./styles.js";
import { PAGE_NAV_STATE_SCRIPT } from "./tabs.js";

/**
 * The <head> every page shares, and the scripts in it, which run before the body
 * paints: the theme, the two-finger swipe between pages, and a desktop server's
 * Quit.
 */

/**
 * The shared document <head>: theming meta, favicons, the inlined stylesheet, the
 * FOUC-safe theme script, and whether Back and Forward have anywhere to go
 * (PAGE_NAV_STATE_SCRIPT). The theme script sets `data-theme` on <html> before the
 * body paints (from localStorage, else the OS preference) and wires the toggle.
 * `extra` is for head markup only some pages need, such as KaTeX's stylesheet
 * or SIDEBAR_RENDER_HOLD.
 */
export function renderHead(title: string, extra = ""): string {
  return `<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
${FAVICON_TAGS}
<title>${title}</title>
<style>${STYLES}</style>${extra}
<script>${THEME_SCRIPT}</script>${desktop ? `\n<script>${QUIT_SCRIPT}</script>` : ""}
<script>${SWIPE_SCRIPT}</script>
<script>${PAGE_NAV_STATE_SCRIPT}</script>
</head>`;
}

/**
 * Site icon links, shared by every page head. The files live in app/public and
 * are served from the site root (see server/static.ts). The .ico covers legacy
 * browsers and the automatic /favicon.ico request; the SVG and sized PNGs cover
 * modern tabs, bookmarks, and iOS home-screen shortcuts.
 */
const FAVICON_TAGS = `<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/kb25.svg" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`;

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
 * In Crescent's macOS window, two fingers across the trackpad go Back and
 * Forward at once (feedback #26, #27). The window's own swipe slid the page
 * aside under the fingers before changing it, and WebKit offers it with no
 * way to drop the slide; so the window turns it off and, before any page
 * script runs, sets `window.kbWindow.swipe` to whether System Settings
 * swipes between pages with two fingers. A browser swipes the way it does,
 * sets nothing, and gets none of this.
 *
 * A swipe is one run of wheel events with no pause in it, momentum included.
 * It counts when its first movement is mostly sideways, nothing under the
 * pointer can still scroll that way (a wide table, a code block), and it
 * goes on far enough. Then it goes back, for fingers moving right, or
 * forward, once, and the rest of the run is let go. A page that opens on
 * the tail of a run waits for it to end. The root's sideways rubber band
 * goes too, since nothing slides any more.
 */
const SWIPE_SCRIPT = `
(() => {
  const shell = window.kbWindow;
  if (!shell || !shell.swipe) return;
  const DECIDE = 12;
  const GO = 90;
  const PAUSE = 250;
  // "wait" for a pause; "" to judge the next run; then "swipe", "scroll" or "done".
  let mode = "wait";
  let dx = 0;
  let dy = 0;
  let timer = 0;
  const rest = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      mode = "";
      dx = 0;
      dy = 0;
    }, PAUSE);
  };
  rest();
  document.documentElement.style.overscrollBehaviorX = "none";

  function scrollsAcross(target, toward) {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const overflow = getComputedStyle(el).overflowX;
      if (!field && el !== document.scrollingElement && overflow !== "auto" && overflow !== "scroll") continue;
      if (toward < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }
    return false;
  }

  window.addEventListener(
    "wheel",
    (event) => {
      rest();
      if (mode === "wait" || mode === "scroll" || mode === "done") return;
      // A pinch, a scroll something on the page has taken, such as the
      // diagram viewer's, or one over a dialog: the feedback dialog draws
      // itself in a shadow root, where no selector here can see it open.
      const over = event.target instanceof Element ? event.target : null;
      const dialog = document.querySelector("dialog[open]") || (over && over.closest("dialog, feedback-widget"));
      if (event.ctrlKey || event.defaultPrevented || dialog) {
        mode = "scroll";
        return;
      }
      dx += event.deltaX;
      dy += event.deltaY;
      if (mode === "") {
        if (Math.abs(dx) + Math.abs(dy) < DECIDE) return;
        mode = Math.abs(dx) > Math.abs(dy) * 2 && !scrollsAcross(event.target, dx) ? "swipe" : "scroll";
        if (mode === "scroll") return;
      }
      if (Math.abs(dx) < GO) return;
      mode = "done";
      // Fingers moving right scroll left with natural scrolling, the macOS default.
      const natural = event.webkitDirectionInvertedFromDevice !== false;
      if ((dx < 0) === natural) history.back();
      else history.forward();
    },
    { passive: true }
  );
  // Put back from the back/forward cache, perhaps by the run still going.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    mode = "wait";
    rest();
  });
})();
`;
