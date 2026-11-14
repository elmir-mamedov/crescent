import { themeColors } from "./styles.js";

/**
 * HTML widgets: figures an agent writes as an HTML file of their own under a
 * space's `_assets/` (an animation, a model with sliders, a chart), which a
 * page embeds with the image syntax, `![TCP handshake](_assets/tcp.html =x420)`.
 *
 * A widget is untrusted, like everything in the KB, and it needs its scripts,
 * so it runs in a sandboxed frame with an origin of its own and no network
 * (`embedHeaders` in assets.ts): it can't read or change Crescent's pages, and
 * it has nothing to send anywhere. What it gets from Crescent comes in a
 * preamble put in front of it (widgetDocument): the theme's colours and fonts,
 * and a script that tells the page how tall the widget is. The frame and the
 * page talk only through postMessage, each message an object whose `kb25`
 * says what it is:
 *
 * - frame to page: `ready` once it starts, `height` whenever its height
 *   changes, `themed` once it has taken a theme;
 * - page to frame: `theme`, the one to wear, in answer to `ready` and whenever
 *   it changes.
 */

/**
 * The colours a widget is drawn in, as CSS variables that follow Crescent's
 * theme. The names are what agents are told to use (mcp.ts, chat.ts), so they
 * stay put whatever the stylesheet's own tokens are called.
 */
const WIDGET_COLORS: Record<string, string> = {
  "--kb-bg": "bg",
  "--kb-fg": "fg",
  "--kb-muted": "muted",
  "--kb-line": "line",
  "--kb-surface": "code-bg",
  "--kb-accent": "accent",
  "--kb-on-accent": "on-accent",
  "--kb-red": "label-red-dot",
  "--kb-orange": "label-orange-dot",
  "--kb-yellow": "label-yellow-dot",
  "--kb-green": "label-green-dot",
  "--kb-teal": "label-teal-dot",
  "--kb-blue": "label-blue-dot",
  "--kb-purple": "label-purple-dot",
  "--kb-pink": "label-pink-dot",
  "--kb-brown": "label-brown-dot",
  "--kb-gray": "label-gray-dot",
};

/** The variables' names, for the rules agents are given. */
export const WIDGET_VARIABLES = [...Object.keys(WIDGET_COLORS), "--kb-font", "--kb-mono"];

function themeBlock(theme: "light" | "dark"): string {
  const colors = themeColors(theme);
  const vars = Object.entries(WIDGET_COLORS).map(([name, token]) => `${name}:${colors[token]};`);
  return `color-scheme:${theme}; ${vars.join(" ")}`;
}

/**
 * The preamble's styles: both themes, the dark one, Crescent's default, until
 * the page says otherwise, and a body in Crescent's type on a clear
 * background, so the page shows through. Nothing shows until the frame knows
 * its theme, so a widget never flashes the wrong one first. The frame's
 * `color-scheme` matches the page's, or a browser backs it with an opaque
 * canvas.
 */
const WIDGET_STYLES = `:root{${themeBlock("dark")}
--kb-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
--kb-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
:root[data-theme="light"]{${themeBlock("light")}}
:root:not([data-theme]){visibility:hidden}
html,body{margin:0}
body{font:16px/1.6 var(--kb-font); color:var(--kb-fg); background:transparent}
button,input,select,textarea{font:inherit}`;

/**
 * The preamble's script: it takes the theme the page sends, setting
 * `data-theme` on <html> and firing `kb25-theme` on the window for a widget
 * that draws in script, and reports the height of <html> as it changes. A
 * height of 0 is not reported, since that is a widget drawn with absolute
 * positions, which keeps the height its frame started at. Opened on its own,
 * with no page around it, the frame follows the system's theme; in a page
 * that never answers, it shows in the dark theme, Crescent's default, after a
 * second.
 */
const WIDGET_SCRIPT = `(() => {
  const root = document.documentElement;
  const page = window.parent;
  const wear = (theme) => {
    root.dataset.theme = theme === "light" ? "light" : "dark";
    dispatchEvent(new Event("kb25-theme"));
  };
  if (page === window) {
    wear(matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    return;
  }
  const fallback = setTimeout(() => { if (!root.dataset.theme) wear("dark"); }, 1000);
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== page || !data || data.kb25 !== "theme") return;
    clearTimeout(fallback);
    wear(data.theme);
    page.postMessage({ kb25: "themed", theme: root.dataset.theme }, "*");
  });
  let last = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (!height || height === last) return;
    last = height;
    page.postMessage({ kb25: "height", height }, "*");
  }).observe(root);
  page.postMessage({ kb25: "ready" }, "*");
})();`;

/**
 * A widget as its frame is sent it: the preamble, then the widget's own HTML.
 * The preamble opens the document, so a doctype of the widget's own, which
 * has to come first, is taken off; the rest of a whole document's <html> and
 * <head> merge into the preamble's, the way a browser reads a second one, and
 * a fragment lands in the body.
 */
export function widgetDocument(source: string): string {
  const own = source.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, "");
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<style>${WIDGET_STYLES}</style>
<script>${WIDGET_SCRIPT}</script>
${own}`;
}

/**
 * The page's side, on a page that shows a widget: it sizes each frame to the
 * height the widget reports, up to MAX_HEIGHT, and tells each frame the theme
 * when it starts and whenever the reader switches it. A message counts only
 * from one of this page's own frames, found by the window it came from, since
 * a sandboxed frame's origin is opaque and names nothing.
 *
 * `__widgetsForPrint(true)` is what a print waits for (PRINT_SCRIPT): every
 * frame loaded, a lazy one included, and in the light theme a print wears,
 * for two seconds at most; `__widgetsForPrint(false)` puts the theme back.
 */
export const WIDGETS_SCRIPT = `
(() => {
  const MAX_HEIGHT = 5000;
  const root = document.documentElement;
  const frames = () => Array.from(document.querySelectorAll("iframe.widget-frame"));
  let printing = false;
  const theme = () => (printing || root.dataset.theme === "light" ? "light" : "dark");
  const tell = (frame) => {
    if (frame.contentWindow) frame.contentWindow.postMessage({ kb25: "theme", theme: theme() }, "*");
  };
  const waiting = new Map();

  addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data.kb25 !== "string") return;
    const frame = frames().find((candidate) => candidate.contentWindow === event.source);
    if (!frame) return;
    if (data.kb25 === "ready") {
      tell(frame);
    } else if (data.kb25 === "height") {
      if (typeof data.height === "number" && data.height > 0) {
        frame.style.height = Math.min(Math.ceil(data.height), MAX_HEIGHT) + "px";
      }
    } else if (data.kb25 === "themed" && data.theme === theme()) {
      const done = waiting.get(frame);
      waiting.delete(frame);
      if (done) done();
    }
  });

  new MutationObserver(() => frames().forEach(tell)).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  window.__widgetsForPrint = (on) => {
    printing = on;
    if (!on) {
      waiting.clear();
      frames().forEach(tell);
      return Promise.resolve();
    }
    const themed = frames().map((frame) => new Promise((resolve) => {
      waiting.set(frame, resolve);
      frame.loading = "eager";
      tell(frame);
    }));
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
    // A moment after the last answer, for the frames to paint in it.
    return Promise.race([Promise.all(themed), timeout]).then(() => new Promise((resolve) => setTimeout(resolve, 50)));
  };
})();
`;
