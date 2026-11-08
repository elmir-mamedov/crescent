import { desktop } from "./config.js";
import { escapeHtml } from "./html.js";

/**
 * The tab strip across the top of a page, the Back and Forward arrows, and the
 * script that keeps the tabs. TAB_MODEL is that script's state as plain
 * functions, which the tests run on their own.
 */

/**
 * The pages open side by side, as tabs along the top of the window (feedback
 * #18). The server knows nothing of them: TABS_SCRIPT keeps them in the
 * browser and draws them here, and only once there are two, so a person who
 * never opens a second tab sees the page exactly as before. It comes straight
 * after the corner, whose width it measures, and before the sidebar, so the
 * room it takes at the top is there before either paints.
 *
 * `title` is what the tab says for this view. `scrollMemory: false` leaves out
 * a view that is not read, such as the editor, so that it neither takes one of
 * the remembered places nor gets put back where it was.
 */
export function tabStrip(title: string, options: { scrollMemory?: boolean } = {}): string {
  // Crescent's own window is the only one there is, so what it had open can
  // outlast it; a browser can hold the site in several windows at once.
  const reopen = desktop ? " data-tabs-reopen" : "";
  const memory = options.scrollMemory === false ? " data-no-scroll-memory" : "";
  return `<nav class="tab-strip" data-tabs data-tab-title="${escapeHtml(title)}"${reopen}${memory} aria-label="Open pages" hidden>${PAGE_NAV}${CLOSE_OTHER_TABS}<div class="tab-list" data-tab-list></div></nav>
<script>${TABS_SCRIPT}</script>
<script>${PAGE_NAV_SCRIPT}</script>`;
}

/**
 * Back and Forward, as in a browser (feedback #38): what a swipe between
 * pages does, for a click. Crescent's window has no toolbar of its own to
 * hold them. They lead the tab strip, before Close other tabs; with no strip
 * showing, the same pair leads the sidebar, beside the site's name, and
 * gives way to the strip's when it slides in (has-tabs).
 */
export const PAGE_NAV = `<div class="page-nav" role="group" aria-label="History"><button type="button" class="page-nav-button" data-page-back aria-label="Back" title="Back"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg></button><button type="button" class="page-nav-button" data-page-forward aria-label="Forward" title="Forward"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg></button></div>`;

/**
 * Drives every PAGE_NAV on the view, the sidebar's included, which is parsed
 * after this runs: clicks are taken on the document, and the buttons are found
 * again each time they are brought up to date. Where the browser says whether
 * there is anywhere to go (the Navigation API), a button with nowhere to go
 * is disabled; elsewhere both stay on, and history ignores a step past its end.
 */
const PAGE_NAV_SCRIPT = `
(() => {
  const nav = window.navigation;
  function update() {
    if (!nav || typeof nav.canGoBack !== "boolean") return;
    for (const button of document.querySelectorAll("[data-page-back]")) button.disabled = !nav.canGoBack;
    for (const button of document.querySelectorAll("[data-page-forward]")) button.disabled = !nav.canGoForward;
  }
  document.addEventListener("DOMContentLoaded", update);
  window.addEventListener("pageshow", update);
  if (nav && typeof nav.addEventListener === "function") nav.addEventListener("currententrychange", update);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-page-back]")) history.back();
    else if (target.closest("[data-page-forward]")) history.forward();
  });
})();
`;

/**
 * The strip's first control, at its left end: close every tab but the open
 * one. The glyph is a tab with a cross on it, in front of another.
 */
const CLOSE_OTHER_TABS = `<button type="button" class="tabs-close-others" data-tabs-close-others aria-label="Close other tabs" title="Close other tabs"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 2.5h6.75a1.25 1.25 0 0 1 1.25 1.25v6.75"/><rect x="2.5" y="5.5" width="8" height="8" rx="1.25"/><path d="M5 8l3 3M8 8l-3 3"/></svg></button>`;

/**
 * What TABS_SCRIPT keeps, as plain functions of the stored state with no DOM
 * in them, so that views.test.ts can run them.
 *
 * The tabs are `{ tabs: [{ id, url, title }], active }`, each `url` a path on
 * this site, and `active` the tab this window shows. The scroll memory is
 * `{ at: { url: y }, recent: [url] }`: where each page was left, kept for the
 * pages in tabs and for the one being read and the SCROLL_RECENT before it.
 */
export const TAB_MODEL = `
  const SCROLL_RECENT = 3;

  // A path on this site: never another origin's //host or /\\host.
  function tabsPath(url) {
    return typeof url === "string" && url.charAt(0) === "/" && url.charAt(1) !== "/" && url.charCodeAt(1) !== 92;
  }

  /** Stored tabs, or null when there are none to read. */
  function tabsValid(saved) {
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.tabs)) return null;
    const seen = new Set();
    const tabs = [];
    for (const t of saved.tabs) {
      if (!t || typeof t.id !== "string" || !t.id || seen.has(t.id) || !tabsPath(t.url)) continue;
      seen.add(t.id);
      tabs.push({ id: t.id, url: t.url, title: typeof t.title === "string" ? t.title : "" });
    }
    return { tabs: tabs, active: typeof saved.active === "string" ? saved.active : "" };
  }

  /**
   * A page has loaded: it is what the open tab now shows. Back and Forward walk
   * one history that every tab shares, so arriving that way at a page another
   * tab holds goes back to that tab, rather than copying the page into this one.
   */
  function tabsArrive(state, here, title, navType, newId) {
    let tab = state.tabs.find((t) => t.id === state.active);
    if (!tab || (navType === "back_forward" && tab.url !== here)) {
      tab = state.tabs.find((t) => t.url === here) || tab;
    }
    if (!tab) {
      tab = { id: newId(), url: here, title: title };
      state.tabs.push(tab);
    }
    tab.url = here;
    tab.title = title;
    state.active = tab.id;
    return state;
  }

  /** Open a page in a tab of its own, beside the open one; a page already in a tab is switched to instead. */
  function tabsOpen(state, url, title, newId) {
    let tab = state.tabs.find((t) => t.url === url);
    if (!tab) {
      tab = { id: newId(), url: url, title: title };
      const at = state.tabs.findIndex((t) => t.id === state.active);
      state.tabs.splice(at < 0 ? state.tabs.length : at + 1, 0, tab);
    }
    state.active = tab.id;
    return tab;
  }

  /** Close every tab but the open one. */
  function tabsCloseOthers(state) {
    const open = state.tabs.filter((t) => t.id === state.active);
    if (open.length) state.tabs = open;
    return state;
  }

  /** Close a tab; closing the open one opens its neighbour, the one after it first. */
  function tabsClose(state, id) {
    const at = state.tabs.findIndex((t) => t.id === id);
    if (at < 0) return state;
    state.tabs.splice(at, 1);
    if (state.active === id) {
      const next = state.tabs[at] || state.tabs[at - 1];
      state.active = next ? next.id : "";
    }
    return state;
  }

  /** Pages moved in the sidebar take their tabs, and their subpages' tabs, along. */
  function tabsMoved(state, moves) {
    const pathOf = (slug) => "/" + slug.split("/").map(encodeURIComponent).join("/");
    for (const tab of state.tabs) {
      for (const move of moves) {
        if (!move || typeof move.oldSlug !== "string" || typeof move.newSlug !== "string") continue;
        const from = pathOf(move.oldSlug);
        if (tab.url === from || tab.url.indexOf(from + "/") === 0) {
          tab.url = pathOf(move.newSlug) + tab.url.slice(from.length);
          break;
        }
      }
    }
    return state;
  }

  /** Where to put a page back to: 0 for a page with no place kept. */
  function scrollFor(memory, here) {
    const at = memory && typeof memory === "object" && memory.at && typeof memory.at === "object" ? memory.at : null;
    const y = at && Object.prototype.hasOwnProperty.call(at, here) ? at[here] : 0;
    return typeof y === "number" && y > 0 ? y : 0;
  }

  /** Keep where a page is; forget every page neither in a tab (keep) nor read lately. */
  function scrollRemember(memory, here, y, keep) {
    const ok = memory && typeof memory === "object" && memory.at && typeof memory.at === "object" && Array.isArray(memory.recent);
    const at = ok ? memory.at : {};
    const before = ok ? memory.recent.filter((u) => tabsPath(u) && u !== here) : [];
    at[here] = y;
    const next = { at: {}, recent: [here].concat(before).slice(0, 1 + SCROLL_RECENT) };
    for (const url of new Set(next.recent.concat(keep))) {
      if (Object.prototype.hasOwnProperty.call(at, url) && typeof at[url] === "number") next.at[url] = at[url];
    }
    return next;
  }
`;

/**
 * The tabs (tabStrip) and where each page was left, on the TAB_MODEL above.
 *
 * Every view is its own page load, so a tab is just an address: switching tabs
 * loads the other tab's page, and a page loading takes over the open tab, the
 * way following a link does in a browser. The tabs live in sessionStorage,
 * which is this window's alone; Crescent's own window also copies them to
 * localStorage, and a new window opening on the home page goes back to the tab
 * the last one had open.
 *
 * Cmd/Ctrl-click or a middle click on a link to a Crescent page opens it in a
 * new tab. Crescent's window would otherwise send that click to the browser,
 * as it does any link asked for in a new window, so the click never reaches it.
 * A new tab shows up on the page it opens, once that has loaded: the strip
 * slides down when it is the second tab, and the tab fades in when it joins
 * others. Until then the page that was open stays as it was. A plain click on
 * a link to the page already open does nothing.
 *
 * Scroll positions go in localStorage, for the pages in tabs and the last few
 * read in any (scrollRemember). One comes back only when a page is opened
 * afresh: a #section link goes to its section, and Back, Forward and a reload
 * get the browser's own restore, which stays per history entry. The page is
 * kept out of sight until it is in place, then held there while late images
 * and diagrams settle: put back after it had painted, it slid down from the
 * top in a run of jumps.
 */
const TABS_SCRIPT = `
(() => {
  const strip = document.querySelector("[data-tabs]");
  const list = strip && strip.querySelector("[data-tab-list]");
  if (!strip || !list) return;
${TAB_MODEL}
  const TABS_KEY = "kb25.tabs";
  const SCROLL_KEY = "kb25.scroll";
  const ARRIVAL_KEY = "kb25.tabs-arrival";
  const root = document.documentElement;
  const here = location.pathname + location.search;
  const title = strip.getAttribute("data-tab-title") || document.title;
  const reopen = strip.hasAttribute("data-tabs-reopen");

  // A glyph built as nodes: no page script here assigns HTML.
  function glyph(size, attrs, paths) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true");
    for (const name of Object.keys(attrs)) svg.setAttribute(name, attrs[name]);
    for (const d of paths) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }
  const pageGlyph = () =>
    glyph(14, { class: "tab-icon", fill: "none", stroke: "currentColor", "stroke-width": "1.3", "stroke-linejoin": "round" }, [
      "M4.25 1.75h4.5l3.5 3.5v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z",
      "M8.5 1.75v3.75h3.75",
    ]);
  const crossGlyph = () =>
    glyph(10, { fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round" }, ["M4 4l8 8M12 4l-8 8"]);

  function read(store, key) {
    try {
      return JSON.parse(window[store].getItem(key) || "null");
    } catch {
      return null;
    }
  }
  function write(store, key, value) {
    try {
      if (value === null) window[store].removeItem(key);
      else window[store].setItem(key, JSON.stringify(value));
    } catch {}
  }
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function parse(href) {
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin ? url : null;
    } catch {
      return null;
    }
  }
  function pathOf(href) {
    const url = parse(href);
    return url ? url.pathname + url.search : "";
  }
  function navType() {
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      return nav ? nav.type : "navigate";
    } catch {
      return "navigate";
    }
  }
  // Once the page and its images are in, or after a while if they never are.
  function whenLoaded(run, wait) {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      requestAnimationFrame(run);
    };
    if (document.readyState === "complete") return once();
    window.addEventListener("load", once, { once: true });
    window.setTimeout(once, wait);
  }

  // Without a sessionStorage of its own, every page would look like the
  // first in a new window, and the home page could never be reached.
  const windowed = (() => {
    try {
      sessionStorage.setItem("kb25.probe", "1");
      sessionStorage.removeItem("kb25.probe");
      return true;
    } catch {
      return false;
    }
  })();
  let state = tabsValid(read("sessionStorage", TABS_KEY));
  const fresh = windowed && !state;
  if (!state && reopen) state = tabsValid(read("localStorage", TABS_KEY));
  if (!state) state = { tabs: [], active: "" };

  function save() {
    write("sessionStorage", TABS_KEY, state);
    if (reopen) write("localStorage", TABS_KEY, state);
  }

  // The window opens on the home page. Once per window, since sessionStorage
  // is the window's: go back to what was open when the last one closed.
  if (fresh && reopen && here === "/") {
    const last = state.tabs.find((t) => t.id === state.active);
    if (last && last.url !== "/") {
      save();
      location.replace(last.url);
      return;
    }
  }

  tabsArrive(state, here, title, navType(), newId);
  save();

  // The tab this page was opened into, left by openTab on the page before.
  const arrival = read("sessionStorage", ARRIVAL_KEY);
  write("sessionStorage", ARRIVAL_KEY, null);
  const arrived = arrival && arrival.url === here && typeof arrival.tab === "string" ? arrival : null;

  function draw(newTab) {
    list.textContent = "";
    for (const tab of state.tabs) {
      const open = tab.id === state.active;
      const name = tab.title || tab.url;
      const item = document.createElement("div");
      item.className = "tab" + (open ? " is-open" : "") + (tab.id === newTab ? " is-new" : "");
      item.setAttribute("data-tab", tab.id);
      const link = document.createElement("a");
      link.className = "tab-link";
      link.href = tab.url;
      link.title = name;
      link.textContent = name;
      // The reflected property, so that no view carries the attribute's name
      // in its HTML: one with no open page claims nothing as current.
      if (open) link.ariaCurrent = "page";
      const shut = document.createElement("button");
      shut.type = "button";
      shut.className = "tab-close";
      shut.setAttribute("data-tab-close", "");
      shut.setAttribute("aria-label", "Close " + name);
      shut.title = "Close tab";
      shut.append(crossGlyph());
      item.append(pageGlyph(), link, shut);
      list.append(item);
    }
    const openItem = list.querySelector(".tab.is-open");
    if (openItem && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = openItem.offsetLeft - (list.clientWidth - openItem.offsetWidth) / 2;
    }
  }

  // The strip comes and goes by sliding, the page moving with it; a page
  // that loads with tabs already open just has it, so moving between them
  // never animates anything.
  let settling = 0;
  function showStrip(shown, animate) {
    const visible = !strip.hidden && !strip.classList.contains("is-leaving");
    if (shown === visible) return;
    window.clearTimeout(settling);
    strip.classList.remove("is-entering", "is-leaving");
    if (!animate) {
      strip.hidden = !shown;
      root.classList.toggle("has-tabs", shown);
      return;
    }
    root.classList.add("tabs-animate");
    strip.hidden = false;
    strip.classList.add(shown ? "is-entering" : "is-leaving");
    root.classList.toggle("has-tabs", shown);
    settling = window.setTimeout(() => {
      root.classList.remove("tabs-animate");
      strip.classList.remove("is-entering");
      if (strip.classList.contains("is-leaving")) {
        strip.classList.remove("is-leaving");
        strip.hidden = true;
      }
    }, 360);
  }

  // The corner's tools sit at the right end of the strip; the tabs stop short
  // of them, however many tools this view has.
  const corner = document.querySelector(".session-corner");
  const reserve = () => {
    strip.style.setProperty("--tabs-reserve", (corner ? corner.offsetWidth : 0) + "px");
  };
  reserve();
  if (corner && typeof ResizeObserver === "function") new ResizeObserver(reserve).observe(corner);

  const shown = state.tabs.length > 1;
  draw(arrived ? arrived.tab : "");
  if (shown && arrived && arrived.strip) {
    whenLoaded(() => showStrip(true, true), 2000);
  } else {
    showStrip(shown, false);
  }
  // A new tab waits, faded out, for its page to load.
  whenLoaded(() => root.classList.add("tabs-loaded"), 2000);

  function showTab(id) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab || id === state.active) return;
    state.active = id;
    save();
    draw("");
    location.href = tab.url;
  }

  function closeTab(id) {
    const wasOpen = id === state.active;
    tabsClose(state, id);
    save();
    const next = state.tabs.find((t) => t.id === state.active);
    // The next tab's page draws the strip as it should be.
    if (wasOpen && next) {
      location.href = next.url;
      return;
    }
    if (state.tabs.length < 2) {
      showStrip(false, true);
      return;
    }
    const item = list.querySelector('[data-tab="' + CSS.escape(id) + '"]');
    if (!item) return draw("");
    item.classList.add("is-closing");
    window.setTimeout(() => draw(""), 160);
  }

  function openTab(href, name) {
    const url = parse(href);
    if (!url) return;
    const path = url.pathname + url.search;
    // A link into this same page is followed here.
    if (path === here) {
      if (url.hash) location.hash = url.hash;
      return;
    }
    const before = state.tabs.length;
    const known = state.tabs.some((t) => t.url === path);
    const tab = tabsOpen(state, path, name || path, newId);
    save();
    if (known) draw("");
    else write("sessionStorage", ARRIVAL_KEY, { url: path, tab: tab.id, strip: before < 2 });
    location.href = path + url.hash;
  }

  // The others fold away as the strip slides off: one tab needs no strip.
  const closeOthers = strip.querySelector("[data-tabs-close-others]");
  if (closeOthers) {
    closeOthers.addEventListener("click", () => {
      tabsCloseOthers(state);
      save();
      for (const item of list.querySelectorAll(".tab:not(.is-open)")) item.classList.add("is-closing");
      showStrip(false, true);
    });
  }

  list.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const item = target ? target.closest("[data-tab]") : null;
    if (!item) return;
    // Modifier keys too: the window would send a tab's link to the browser.
    event.preventDefault();
    const id = item.getAttribute("data-tab") || "";
    if (target.closest("[data-tab-close]")) closeTab(id);
    else showTab(id);
  });
  // The middle button closes a tab, as in a browser, and starts no autoscroll.
  list.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  list.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const item = event.target instanceof Element ? event.target.closest("[data-tab]") : null;
    if (!item) return;
    event.preventDefault();
    closeTab(item.getAttribute("data-tab") || "");
  });

  // Cmd/Ctrl+W closes the open tab, as in a browser, but never the last one,
  // which would leave nothing to show (feedback #29). Crescent's window has
  // no Close item of its own, so the keys reach the page; a browser keeps
  // them for its own tabs.
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "w") return;
    event.preventDefault();
    if (state.tabs.length > 1) closeTab(state.active);
  });

  // A link to a Crescent page: not a file (a download, a space's asset), and
  // not one a script on the page has already handled. On the window, so that
  // every listener on the document has had its turn first.
  function pageLink(event) {
    if (event.defaultPrevented) return null;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.hasAttribute("download") || strip.contains(link)) return null;
    const path = pathOf(link.href);
    if (!path) return null;
    if (path.split("?")[0].split("/")[2] === "_assets") return null;
    return link;
  }
  window.addEventListener("click", (event) => {
    if (event.button !== 0 || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const link = pageLink(event);
    if (!link) return;
    event.preventDefault();
    openTab(link.href, (link.textContent || "").trim());
  });
  window.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const link = pageLink(event);
    if (!link) return;
    event.preventDefault();
    openTab(link.href, (link.textContent || "").trim());
  });
  // A plain click on a link to the page already open, such as its own row in
  // the sidebar, stays on it (feedback #50): loading it again only blinked it
  // and folded the groups opened by hand. A link to one of its sections still
  // goes there.
  window.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = pageLink(event);
    if (!link || (link.target && link.target !== "_self")) return;
    if (link.href.indexOf("#") >= 0 || pathOf(link.href) !== here) return;
    event.preventDefault();
  });

  // A page put back from the back/forward cache runs none of the above again.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    state = tabsValid(read("sessionStorage", TABS_KEY)) || state;
    tabsArrive(state, here, title, "back_forward", newId);
    save();
    draw("");
    showStrip(state.tabs.length > 1, false);
  });

  // MOVE_SCRIPT, once a drag in the sidebar has moved pages.
  window.kbTabs = {
    moved(moves) {
      if (!Array.isArray(moves)) return;
      tabsMoved(state, moves);
      save();
    },
  };

  if (strip.hasAttribute("data-no-scroll-memory")) return;

  const target = scrollFor(read("localStorage", SCROLL_KEY), here);
  // Until the page is back where it was left, that is where it is: leaving
  // before then must not keep the top of it instead.
  let placing = target > 0 && navType() === "navigate" && !location.hash;
  const remember = () => {
    const y = placing ? target : Math.round(window.scrollY);
    const keep = state.tabs.map((t) => t.url);
    write("localStorage", SCROLL_KEY, scrollRemember(read("localStorage", SCROLL_KEY), here, y, keep));
  };
  let timer = 0;
  window.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(remember, 200);
    },
    { passive: true }
  );
  window.addEventListener("pagehide", remember);

  if (!placing) return;
  // Out of sight (kb-placing) until its images are in and it can be put
  // where it was, then held there: whatever is at the top of the view stays
  // put while a diagram renders above it or the strip slides in, until the
  // reader scrolls or it has all settled.
  root.classList.add("kb-placing");
  const STOP = ["wheel", "touchstart", "keydown", "mousedown"];
  let observer = null;
  let anchor = null;
  let anchorTop = 0;
  let reached = false;
  const pickAnchor = () => {
    const line = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    anchor = null;
    for (const el of document.querySelectorAll("main .prose > *, main > *")) {
      const box = el.getBoundingClientRect();
      if (box.height > 0 && box.bottom > line) {
        anchor = el;
        anchorTop = box.top;
        return;
      }
    }
  };
  const hold = () => {
    if (!placing) return;
    if (!reached) {
      // The page was too short to get there; it has grown, so try again.
      window.scrollTo(0, target);
      reached = window.scrollY >= target - 1;
      pickAnchor();
      return;
    }
    if (!anchor || !anchor.isConnected) return pickAnchor();
    const moved = anchor.getBoundingClientRect().top - anchorTop;
    if (Math.abs(moved) >= 1) window.scrollBy(0, moved);
  };
  const finish = () => {
    if (!placing) return;
    placing = false;
    if (observer) observer.disconnect();
    for (const type of STOP) window.removeEventListener(type, finish, true);
  };
  // Back on the page it was on, as after a form that returns to it: the
  // reader saw it there a moment ago, and fading it in again blinked it
  // (feedback #50).
  const cameBack = document.referrer === location.href;
  const place = () => {
    window.scrollTo(0, target);
    reached = window.scrollY >= target - 1;
    root.classList.remove("kb-placing");
    if (!cameBack) root.classList.add("kb-placed");
    pickAnchor();
    for (const type of STOP) window.addEventListener(type, finish, { capture: true, passive: true });
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(hold);
      observer.observe(document.body);
    }
    window.setTimeout(finish, 3000);
  };
  // Not long after the text is in, even if an image never arrives.
  const ready = () => whenLoaded(place, 600);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
`;
