/**
 * The page's layout blocks (markdown.ts): collapsible sections, `:::details`,
 * which the browser opens and closes on its own, and tabs, `:::tabs`, rendered
 * as panels one after another, each under its title, which this script turns
 * into a row of tabs showing one panel at a time.
 *
 * Whatever the reader asked for is shown, opening the sections and picking the
 * tabs it is inside (`kb25Reveal`):
 *
 * - the element an address names, as the page opens and on every hash change,
 *   and the one a link into this page leads to, before the browser scrolls;
 * - a match find on the page steps to (FIND_SCRIPT calls `kb25Reveal`).
 *
 * On paper every section is open, for the print only (PRINT_SCRIPT), and every
 * tab's panel shows under its title (the print stylesheet in views/styles.ts).
 */
export const BLOCKS_SCRIPT = `
(() => {
  const article = document.querySelector("article.prose");
  if (!article) return;

  // Tabs: a row of buttons, one per panel, copied from the panel's title,
  // before the first panel. The titles themselves are hidden while it shows.
  const groups = [];
  let next = 0;
  for (const block of article.querySelectorAll(".tabs-block")) {
    const panels = [...block.children].filter((el) => el.classList.contains("tabs-panel"));
    if (!panels.length) continue;
    const bar = document.createElement("div");
    bar.className = "tabs-bar";
    bar.setAttribute("role", "tablist");
    const tabs = panels.map((panel, index) => {
      const id = "kb25-tab-" + (next += 1);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tabs-tab";
      tab.id = id;
      tab.setAttribute("role", "tab");
      const label = panel.querySelector(":scope > .tabs-label");
      if (label) for (const node of label.childNodes) tab.append(node.cloneNode(true));
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", id);
      tab.addEventListener("click", () => pick(group, index, false));
      bar.append(tab);
      return tab;
    });
    const group = { panels, tabs, current: -1 };
    bar.addEventListener("keydown", (event) => {
      const by = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      const at = { Home: 0, End: tabs.length - 1 }[event.key];
      if (by === undefined && at === undefined) return;
      event.preventDefault();
      pick(group, at !== undefined ? at : (group.current + by + tabs.length) % tabs.length, true);
    });
    panels[0].before(bar);
    block.classList.add("is-tabbed");
    groups.push(group);
    pick(group, 0, false);
  }

  function pick(group, index, focus) {
    if (index === group.current) return;
    group.current = index;
    group.tabs.forEach((tab, at) => {
      tab.setAttribute("aria-selected", String(at === index));
      tab.tabIndex = at === index ? 0 : -1;
    });
    group.panels.forEach((panel, at) => { panel.hidden = at !== index; });
    if (focus) group.tabs[index].focus();
  }

  // Shows el: opens every closed section around it and picks every tab it is
  // in. Returns whether anything changed.
  window.kb25Reveal = (el) => {
    let changed = false;
    for (let at = el && el.parentElement; at && at !== article; at = at.parentElement) {
      if (at.tagName === "DETAILS" && !at.open) {
        at.open = true;
        changed = true;
      }
      if (at.classList.contains("tabs-panel") && at.hidden) {
        const group = groups.find((g) => g.panels.includes(at));
        if (group) {
          pick(group, group.panels.indexOf(at), false);
          changed = true;
        }
      }
    }
    return changed;
  };

  // The element a fragment names, found the way the browser finds where to
  // scroll: as it is, then percent-decoded.
  function named(hash) {
    if (!hash || hash.length < 2) return null;
    const raw = hash.slice(1);
    let el = document.getElementById(raw);
    if (!el) {
      try { el = document.getElementById(decodeURIComponent(raw)); } catch (e) { el = null; }
    }
    return el && article.contains(el) ? el : null;
  }

  function revealHash() {
    const el = named(location.hash);
    if (el && window.kb25Reveal(el)) el.scrollIntoView({ block: "start" });
  }
  revealHash();
  window.addEventListener("hashchange", revealHash);

  // A link into this page: open the way before the browser scrolls to it.
  document.addEventListener("click", (event) => {
    const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    let url;
    try { url = new URL(link.href, location.href); } catch (e) { return; }
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    const el = named(url.hash);
    if (el) window.kb25Reveal(el);
  }, true);
})();
`;
