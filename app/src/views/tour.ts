/**
 * The tour: a few minutes, on first launch, that show a new person where
 * everything is. The screen dims, and a spotlight glides from one part of the
 * page to the next (the sidebar, search, the page's buttons, notes, the chat,
 * the gallery, dashboards, space instructions, Help), each with a short card.
 * It runs on the example space (example-space.ts), whose pages its cards'
 * animations borrow. The guide in Help (guide.ts) says more about each part;
 * the tour ends by pointing there.
 *
 * It shows each part in use two ways: a small looping animation of the action
 * in the card (a page dragged, a phrase highlighted, a question answered), and,
 * where it can, the real thing opened on the page (search shows results, the
 * ⋯ menu and Download drop open, the note button appears on a selection, the
 * chat slides out), closed again before the next stop.
 *
 * It starts by itself when the page's address carries `?tour=start`, which
 * the first visit after crescent added the example space is sent to
 * (server/guide.ts), and from Help's Take the tour, on any page that has the
 * script. A step whose part of the page is missing is skipped, so the tour
 * fits whatever page it runs on. Its look is `.tour-*` and `.td-*` in
 * styles.ts.
 */

/** Help's button that replays the tour; the script shows it where the tour can run. */
export const TOUR_HELP_BUTTON = `<p data-tour-help hidden><button type="button" class="button secondary" data-tour-start>Take the tour</button> A two-minute walk around this page, showing where everything is.</p>`;

/**
 * The small animations the cards show, by step. Fixed markup, drawn in the
 * theme's colours; each loops on its own (`.td-*` in styles.ts).
 */
const DEMOS: Record<string, string> = {
  pages: `<div class="td-tree"><div class="td-row">Why fields?</div><div class="td-row td-drag">Feynman diagrams</div><div class="td-row td-make-room">The Standard Model</div></div>`,
  spaces: `<div class="td-spaces"><div class="td-space">🧪 Chemistry</div><div class="td-space td-space-pick">🌌 Quantum Field Theory</div><div class="td-space">📓 My notes</div></div>`,
  search: `<div class="td-search"><div class="td-input"><span class="td-typed">field</span><span class="td-caret"></span></div><div class="td-results"><div class="td-result">Why <mark>field</mark>s?</div><div class="td-result"><mark>Field</mark>s before quantum mechanics</div></div></div>`,
  buttons: `<div class="td-page"><div class="td-page-bar"><span class="td-btn">Edit</span></div><div class="td-page-view"><div class="td-line td-line-h"></div><div class="td-line"></div><div class="td-line td-line-short"></div></div><div class="td-page-md"><code>## Virtual particles</code><code>The photon in the **middle**…</code></div></div>`,
  menu: `<div class="td-menu"><div class="td-menu-row"><span>Feynman diagrams</span><span class="td-menu-dots">⋯</span></div><div class="td-menu-pop"><div>New page</div><div>Labels</div><div>Archive</div></div></div>`,
  notes: `<div class="td-notes"><p>The steps are <span class="td-hl">evenly spaced</span>: one rung always costs ħω.</p><div class="td-chips"><span>Highlight</span><span>Remark</span><span>Task</span></div></div>`,
  chat: `<div class="td-chat"><div class="td-ask">What is a virtual photon?</div><div class="td-typing"><i></i><i></i><i></i></div><div class="td-answer">A term in the calculation, not a particle you can catch.</div></div>`,
  gallery: `<div class="td-grid"><i></i><i></i><i></i><i></i><i></i><i></i></div>`,
  dashboards: `<div class="td-tasks"><div class="td-task">Add a worked example on Fock space</div><div class="td-task">Add a diagram</div><div class="td-task">Check the sources</div></div>`,
  instructions: `<div class="td-orders"><div class="td-orders-head">Space instructions</div><div class="td-orders-text">Keep ħ and c until a page sets them to 1.</div></div>`,
};

/**
 * The demos, for the page to carry in a <template> the script copies them out
 * of: they are drawn as markup here, on the server, so the script builds no
 * HTML from text (views.test.ts holds every script to that).
 */
export const TOUR_DEMOS = `<template data-tour-demos>${Object.entries(DEMOS)
  .map(([key, html]) => `<div class="td-scene" data-tour-demo="${key}">${html}</div>`)
  .join("")}</template>`;

export const TOUR_SCRIPT = `
(() => {
  const demos = document.querySelector("template[data-tour-demos]");
  function demoFor(key) {
    const scene = demos && key ? demos.content.querySelector('[data-tour-demo="' + key + '"]') : null;
    return scene ? scene.cloneNode(true) : null;
  }
  const STEPS = [
    { title: "Welcome to crescent", text: "You are in an example space, Quantum Field Theory: real pages to look around in, and yours to change or delete. This short tour shows where everything is, in about two minutes: use the buttons below, or the arrow keys." },
    { target: ".sidebar nav.tree", demo: "pages", title: "Your pages", text: "The sidebar lists the pages of the space you are in. Click a page to open it, and drag it to move it somewhere else." },
    { target: ".space-current", demo: "spaces", title: "Spaces", text: "A space is a separate collection, for one subject or one project. This is the space you are in; All spaces, below it, lists the rest." },
    { target: ".sidebar-search", demo: "search", open: "search", title: "Search", text: "Search this space by title and by text. From anywhere, press \\u2318/Ctrl + K." },
    { target: ".page-head .actions", demo: "buttons", open: "download", title: "Page buttons", text: "Edit changes the page. Diff shows its earlier versions, and Download saves it as a PDF or a Markdown file." },
    { target: [".tree a.active", ".tree a[data-drag-slug]"], row: true, demo: "menu", open: "menu", title: "The \\u22ef menu", text: "Point at a page in the sidebar and click \\u22ef beside it to add a page under it, give it a label, archive it or delete it." },
    { target: "article.prose", demo: "notes", open: "note", title: "Notes", text: "Select any text on a page to highlight it, add a remark, or leave yourself a task to come back to." },
    { target: "[data-chat-open]", demo: "chat", open: "chat", title: "The chat", text: "Ask questions about your pages, or ask the chat to write a page for you. It uses Claude Code or Codex on this computer." },
    { target: ".gallery-button", demo: "gallery", title: "Gallery", text: "Every image in this space. Upload images here to show them on your pages." },
    { target: ".dash-button", demo: "dashboards", title: "Dashboards", text: "Your open tasks, and your pages grouped by label." },
    { target: ".instructions-button", demo: "instructions", title: "Space instructions", text: "Standing orders for any AI that writes in this space, such as a language or a tone." },
    { target: "[data-help-open]", title: "Help", text: "Keyboard shortcuts, the getting-started guide, and this tour again, whenever you want them." },
    { title: "You are all set", text: "The guide in Help explains each of these in more detail. Read on through Quantum Field Theory, or make a space of your own. Enjoy crescent!" },
  ];

  const helpRow = document.querySelector("[data-tour-help]");
  if (helpRow) helpRow.hidden = false;

  const params = new URL(window.location.href).searchParams;

  let spot = null;
  let card = null;
  let steps = [];
  let at = 0;
  let lastFocus = null;
  let opened = null;
  let timers = [];

  // A step's target is a selector, or a list of them tried in order: the first
  // that finds something on screen wins.
  function targetOf(step) {
    if (!step || !step.target) return null;
    for (const selector of [].concat(step.target)) {
      const found = document.querySelector(selector);
      if (!found) continue;
      const box = found.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      return step.row ? found.closest(".tree-row") || found : found;
    }
    return null;
  }

  // What the tour opens on the page: each opens the real
  // thing and says what else the spotlight should take in, and closes it again.
  const OPENERS = {
    search: {
      open() {
        const input = document.querySelector(".sidebar-search-input");
        if (!input) return;
        input.value = "field";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      close() {
        const input = document.querySelector(".sidebar-search-input");
        if (!input) return;
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const panel = document.querySelector(".sidebar-search-panel");
        if (panel) panel.hidden = true;
        input.setAttribute("aria-expanded", "false");
      },
      also: () => document.querySelector(".sidebar-search-panel:not([hidden])"),
    },
    download: {
      open() { const menu = document.querySelector("[data-download-menu]"); if (menu) menu.open = true; },
      close() { const menu = document.querySelector("[data-download-menu]"); if (menu) menu.open = false; },
      also: () => document.querySelector("[data-download-menu][open] .download-menu-pop"),
    },
    menu: {
      open(target) { const menu = target && target.querySelector("details.tree-menu"); if (menu) menu.open = true; },
      close() { for (const menu of document.querySelectorAll("details.tree-menu[open]")) menu.open = false; },
      also: () => document.querySelector("details.tree-menu[open] .tree-menu-pop"),
    },
    note: {
      open(target) {
        // Select the first few words of the page, as a reader would with the
        // mouse, so the page offers its note button beside them.
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => (node.textContent.trim().length > 20 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
        });
        const text = walker.nextNode();
        if (!text) return;
        const lead = text.textContent.length - text.textContent.trimStart().length;
        const words = text.textContent.slice(lead).match(/^(\\S+\\s+){0,4}\\S+/);
        const range = document.createRange();
        range.setStart(text, lead);
        range.setEnd(text, lead + (words ? words[0].length : Math.min(30, text.textContent.length - lead)));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      },
      close() { const selection = window.getSelection(); if (selection) selection.removeAllRanges(); },
      also: () => document.querySelector(".note-add:not([hidden])"),
    },
    chat: {
      open() {
        const button = document.querySelector("[data-chat-open]");
        if (button && button.getAttribute("aria-expanded") !== "true") button.click();
      },
      close() {
        const button = document.querySelector("[data-chat-open]");
        if (button && button.getAttribute("aria-expanded") === "true") button.click();
      },
      also: () => document.querySelector("[data-chat]:not([hidden])"),
      // The panel slides out at the far side of the window from its button:
      // one box around both would light up the page between them.
      instead: true,
    },
  };

  function closeOpened() {
    timers.forEach(clearTimeout);
    timers = [];
    if (opened) {
      try { opened.close(); } catch (error) {}
      opened = null;
    }
  }

  let marked = null;
  // The part of the page the spotlight is on carries .tour-target, so the page
  // can show what it only shows on hover (a sidebar row's \\u22ef button).
  function mark(target) {
    if (marked === target) return;
    if (marked) marked.classList.remove("tour-target");
    marked = target;
    if (marked) marked.classList.add("tour-target");
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    spot = el("div", "tour-spot");
    spot.setAttribute("aria-hidden", "true");
    card = el("div", "tour-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "tour-title");
    document.body.append(spot, card);
    document.body.classList.add("touring");
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", onKey, true);
  }

  function finish() {
    closeOpened();
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
    document.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("touring");
    mark(null);
    spot.remove();
    card.remove();
    spot = card = null;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function onKey(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); go(at + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); go(at - 1); }
  }

  /** The box around the target and whatever the step opened beside it. */
  function boxOf(target) {
    const boxes = [target.getBoundingClientRect()];
    const extra = opened && opened.also ? opened.also() : null;
    if (extra) {
      const box = extra.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        if (opened.instead) boxes.length = 0;
        boxes.push(box);
      }
    }
    return {
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    };
  }

  function place() {
    if (!spot) return;
    const target = targetOf(steps[at]);
    mark(target);
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!target) {
      // A card on its own: the spotlight closes to the middle and the whole page dims.
      Object.assign(spot.style, { left: vw / 2 + "px", top: vh / 2 + "px", width: "0px", height: "0px" });
      spot.classList.add("is-closed");
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      Object.assign(card.style, { left: Math.round((vw - w) / 2) + "px", top: Math.round((vh - h) / 2) + "px" });
      return;
    }
    spot.classList.remove("is-closed");
    const box = boxOf(target);
    const left = Math.max(4, box.left - pad);
    const top = Math.max(4, box.top - pad);
    const right = Math.min(vw - 4, box.right + pad);
    const bottom = Math.min(vh - 4, box.bottom + pad);
    Object.assign(spot.style, { left: left + "px", top: top + "px", width: right - left + "px", height: bottom - top + "px" });

    // The card goes beside the spotlight where it fits: below, above, right, left.
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const gap = 14;
    let x;
    let y;
    if (bottom + gap + h <= vh) { y = bottom + gap; x = left; }
    else if (top - gap - h >= 0) { y = top - gap - h; x = left; }
    else if (right + gap + w <= vw) { x = right + gap; y = top; }
    else { x = left - gap - w; y = top; }
    x = Math.min(Math.max(12, x), vw - w - 12);
    y = Math.min(Math.max(12, y), vh - h - 12);
    Object.assign(card.style, { left: Math.round(x) + "px", top: Math.round(y) + "px" });
  }

  function render() {
    const step = steps[at];
    card.replaceChildren();
    const count = el("p", "tour-count", "Step " + (at + 1) + " of " + steps.length);
    const title = el("h2", "tour-title", step.title);
    title.id = "tour-title";
    const text = el("p", "tour-text", step.text);
    const parts = [count, title];
    const scene = demoFor(step.demo);
    if (scene) {
      const demo = el("div", "tour-demo");
      demo.setAttribute("aria-hidden", "true");
      demo.append(scene);
      parts.push(demo);
    }
    parts.push(text);
    const dots = el("div", "tour-dots");
    steps.forEach((_, i) => {
      dots.append(el("span", i === at ? "tour-dot is-current" : i < at ? "tour-dot is-done" : "tour-dot"));
    });
    const buttons = el("div", "tour-buttons");
    const last = at === steps.length - 1;
    if (!last) {
      const skip = el("button", "tour-skip", "Skip tour");
      skip.type = "button";
      skip.addEventListener("click", finish);
      buttons.append(skip);
    }
    const back = el("button", "button secondary", "Back");
    back.type = "button";
    back.disabled = at === 0;
    back.addEventListener("click", () => go(at - 1));
    const next = el("button", "button primary", last ? "Done" : at === 0 ? "Start" : "Next");
    next.type = "button";
    next.addEventListener("click", () => (last ? finish() : go(at + 1)));
    buttons.append(back, next);
    card.append(...parts, dots, buttons);
    // Fade the card in afresh at each stop, in its new place.
    card.classList.remove("is-in");
    void card.offsetWidth;
    place();
    card.classList.add("is-in");
    next.focus({ preventScroll: true });
  }

  function go(index) {
    if (index < 0 || index >= steps.length) return;
    closeOpened();
    at = index;
    const step = steps[at];
    const target = targetOf(step);
    if (target && typeof target.scrollIntoView === "function") {
      const box = target.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) target.scrollIntoView({ block: "center" });
    }
    if (step.open && OPENERS[step.open] && target) {
      const opener = OPENERS[step.open];
      opened = opener;
      // Once the click on Next has run its course: the page closes an open
      // menu on any click outside it, which would shut one opened during it.
      timers.push(setTimeout(() => {
        try { opener.open(target); } catch (error) { if (opened === opener) opened = null; }
        place();
      }, 0));
      // What opens may take a moment to arrive (search results, the chat
      // sliding out): follow it as it does.
      for (const ms of [150, 450, 900]) timers.push(setTimeout(place, ms));
    }
    render();
  }

  function start() {
    if (spot) return;
    steps = STEPS.filter((step) => !step.target || targetOf(step));
    lastFocus = document.activeElement;
    const help = document.querySelector("[data-help-dialog]");
    if (help && help.open && typeof help.close === "function") help.close();
    build();
    go(0);
  }

  window.kb25Tour = start;
  for (const button of document.querySelectorAll("[data-tour-start]")) button.addEventListener("click", start);

  if (params.get("tour") === "start") {
    const url = new URL(window.location.href);
    url.searchParams.delete("tour");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    // After the page has laid itself out, so the spotlight lands where things are.
    window.addEventListener("load", () => setTimeout(start, 400), { once: true });
  }
})();
`;
