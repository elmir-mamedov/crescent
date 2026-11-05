import { escapeHtml, labelsHref } from "./html.js";
import type { OfferedLabel } from "./labels.js";

/**
 * The sidebar's search box, scoped to the current space, and the script that
 * searches as the reader types.
 */

/**
 * Sidebar search: an ARIA combobox scoped to the current space. The input owns
 * the combobox role; `SEARCH_SCRIPT` fills the listbox with `<a role="option">`
 * children and tracks the highlighted one through `aria-activedescendant`, so DOM
 * focus never leaves the field.
 *
 * `data-search-space` carries the scope and `data-search-labels` the labels
 * the filter offers, so the script needs no inline data. The filter button
 * stays hidden until the script reveals it, and only when there is a label to
 * pick. With JavaScript off this is an inert field; the Labels view is the
 * full, server-rendered search, and the panel's footer links there.
 */
export function sidebarSearch(spaceKey: string, offered: readonly OfferedLabel[] = []): string {
  return `<div class="sidebar-search" data-search data-search-space="${escapeHtml(spaceKey)}" data-search-labels="${escapeHtml(JSON.stringify(offered))}">
    <div class="sidebar-search-field">
      <input id="kb-search-input" class="sidebar-search-input" type="search" data-search-input
        placeholder="Search this space" aria-label="Search this space"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        role="combobox" aria-expanded="false" aria-autocomplete="list"
        aria-haspopup="listbox" aria-controls="kb-search-results" />
      <button type="button" class="sidebar-search-filter" data-search-filter hidden
        aria-label="Filter by label" title="Filter by label" aria-expanded="false" aria-controls="kb-search-picker">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
        <span class="sidebar-search-filter-count" data-search-filter-count hidden></span>
      </button>
    </div>
    <div class="sidebar-search-chips" data-search-chips hidden></div>
    <div id="kb-search-picker" class="sidebar-search-picker" role="group" aria-label="Filter by label" data-search-picker hidden></div>
    <div class="sidebar-search-panel" data-search-panel hidden>
      <div id="kb-search-results" class="sidebar-search-list" role="listbox"
        aria-label="Search results" data-search-list></div>
      <div class="sidebar-search-status" data-search-status role="status" aria-live="polite" hidden></div>
      <a class="sidebar-search-more" data-search-more href="${escapeHtml(labelsHref(spaceKey))}" hidden>Show all results</a>
    </div>
  </div>`;
}

/**
 * Sidebar search. A debounced GET to /_search fills an ARIA listbox under the
 * input; ↑/↓ move the highlighted option (via aria-activedescendant, so focus
 * stays in the field), Enter opens it, Esc dismisses and then clears.
 * Cmd/Ctrl+K focuses the box from anywhere on the page.
 *
 * The endpoint sends plain text plus the query's tokens — never HTML — and every
 * string reaches the DOM through textContent, so page content cannot inject
 * markup into the dropdown.
 */
export const SEARCH_SCRIPT = `
(() => {
  const root = document.querySelector("[data-search]");
  if (!root) return;
  const input = root.querySelector("[data-search-input]");
  const panel = root.querySelector("[data-search-panel]");
  const list = root.querySelector("[data-search-list]");
  const status = root.querySelector("[data-search-status]");
  if (!input || !panel || !list || !status) return;
  const filterButton = root.querySelector("[data-search-filter]");
  const filterCount = root.querySelector("[data-search-filter-count]");
  const picker = root.querySelector("[data-search-picker]");
  const chips = root.querySelector("[data-search-chips]");
  const more = root.querySelector("[data-search-more]");

  const space = root.getAttribute("data-search-space") || "";
  let offered = [];
  try {
    offered = JSON.parse(root.getAttribute("data-search-labels") || "[]");
  } catch (error) {
    offered = [];
  }
  const hasFilter = !!(filterButton && filterCount && picker && chips) && offered.length > 0;
  // Label names every result must carry, in the order they were picked. Kept
  // per space for the tab's lifetime, so opening a result keeps the filter on.
  const STORE_KEY = "kb:search-labels:" + space;
  let selected = [];
  const DEBOUNCE_MS = 180;
  const MIN_LENGTH = 2;
  const LIMIT = 8;

  let timer = 0;
  let controller = null;
  let items = [];
  let activeIndex = -1;
  // What the newest request asked for — the query and the labels — so a slower
  // answer to an older question is dropped rather than drawn.
  let lastKey = "";
  // Backspacing to a query already asked about is the most common wasted round
  // trip; a plain Map kills it. Cleared wholesale rather than evicted by age —
  // it only has to survive until the next navigation.
  const cache = new Map();

  function labelKey(name) {
    return String(name).trim().normalize("NFC").toLowerCase();
  }

  function colorOf(name) {
    const key = labelKey(name);
    const found = offered.find((entry) => labelKey(entry.name) === key);
    return found ? found.color : "gray";
  }

  function requestKey(query) {
    return JSON.stringify([query, selected]);
  }

  function labelsUrl(query) {
    const params = new URLSearchParams({ space: space });
    selected.forEach((name) => params.append("label", name));
    if (query) params.set("q", query);
    return "/_dashboard/labels?" + params.toString();
  }

  function showMore(query) {
    if (!more) return;
    more.href = labelsUrl(query);
    more.hidden = false;
  }

  function setStatus(text) {
    status.textContent = text || "";
    status.hidden = !text;
  }

  function open() {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function clearList() {
    list.textContent = "";
    items = [];
    activeIndex = -1;
  }

  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    clearList();
    setStatus("");
    if (more) more.hidden = true;
  }

  function setActive(index) {
    const previous = items[activeIndex];
    if (previous) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-selected", "false");
    }
    activeIndex = index;
    const el = items[index];
    if (!el) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    el.classList.add("is-active");
    el.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", el.id);
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }

  // Wrap each occurrence of a query token in <mark>, longest-token-first at any
  // given position so "dep" inside "deploy" cannot produce a nested mark. Every
  // slice goes in as a text node, so nothing here can introduce markup.
  function highlight(target, text, tokens) {
    target.textContent = "";
    const lower = text.toLowerCase();
    // A handful of code points change length when lowercased (e.g. "İ"), which
    // would desync every offset below. Fall back to plain text instead.
    const usable = lower.length === text.length && tokens.length > 0;
    let cursor = 0;
    while (usable && cursor < text.length) {
      let at = -1;
      let length = 0;
      for (const token of tokens) {
        if (!token) continue;
        const found = lower.indexOf(token, cursor);
        if (found === -1) continue;
        if (at === -1 || found < at || (found === at && token.length > length)) {
          at = found;
          length = token.length;
        }
      }
      if (at === -1) break;
      if (at > cursor) target.appendChild(document.createTextNode(text.slice(cursor, at)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(at, at + length);
      target.appendChild(mark);
      cursor = at + length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function render(payload, query) {
    clearList();
    const results = payload.results || [];
    const tokens = payload.tokens || [];
    showMore(query);
    if (!results.length) {
      const where = selected.length ? " with these labels" : " in this space";
      setStatus(query ? "No matches for \\"" + query + "\\"" + where + "." : "No pages carry these labels.");
      open();
      return;
    }
    setStatus("");
    results.forEach((result, index) => {
      const item = document.createElement("a");
      item.className = "sidebar-search-item";
      item.id = "kb-search-opt-" + index;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.href = result.url;

      const title = document.createElement("span");
      title.className = "sidebar-search-title";
      highlight(title, String(result.title || ""), tokens);
      const labels = Array.isArray(result.labels) ? result.labels : [];
      if (labels.length) {
        const dots = document.createElement("span");
        dots.className = "sidebar-search-dots";
        dots.title = labels.join(", ");
        labels.slice(0, 3).forEach((name) => {
          const dot = document.createElement("span");
          dot.className = "label-dot";
          dot.setAttribute("data-label-color", colorOf(name));
          dots.appendChild(dot);
        });
        title.appendChild(dots);
      }
      item.appendChild(title);

      if (result.crumb) {
        const crumb = document.createElement("span");
        crumb.className = "sidebar-search-crumb";
        crumb.textContent = result.crumb;
        item.appendChild(crumb);
      }

      const excerpt = String(result.excerpt || "");
      if (excerpt) {
        const body = document.createElement("span");
        body.className = "sidebar-search-excerpt";
        highlight(body, excerpt, tokens);
        item.appendChild(body);
      }

      item.addEventListener("mousemove", () => setActive(index));
      list.appendChild(item);
      items.push(item);
    });
    open();
    setActive(0);
  }

  async function run(query) {
    if (controller) controller.abort();
    const key = requestKey(query);
    const cached = cache.get(key);
    if (cached) {
      render(cached, query);
      return;
    }

    controller = new AbortController();
    setStatus("Searching…");
    open();
    const url = "/_search?q=" + encodeURIComponent(query) +
      "&space=" + encodeURIComponent(space) + "&limit=" + LIMIT +
      selected.map((name) => "&label=" + encodeURIComponent(name)).join("");
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      // An expired session 303s to the sign-in page, which fetch follows — so a
      // stale tab would get HTML with response.ok true. Reload so the user lands
      // on the login form instead of an empty dropdown.
      if (response.redirected) {
        window.location.reload();
        return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) {
        clearList();
        setStatus(result && result.error ? result.error : "Search failed.");
        return;
      }
      // abort() does not reliably beat a response already in flight, so stale
      // answers are dropped by what they asked for as well.
      if (key !== lastKey) return;
      if (cache.size > 50) cache.clear();
      cache.set(key, result);
      render(result, query);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      clearList();
      setStatus("Search failed.");
    }
  }

  // A query too short to search still counts as none; with labels picked, no
  // query lists the pages carrying them.
  function refresh() {
    const typed = input.value.trim();
    const query = typed.length >= MIN_LENGTH ? typed : "";
    lastKey = requestKey(query);
    window.clearTimeout(timer);
    if (!query && !selected.length) {
      if (controller) controller.abort();
      close();
      return;
    }
    timer = window.setTimeout(() => run(query), DEBOUNCE_MS);
  }

  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => {
    if (selected.length && panel.hidden) refresh();
  });

  function togglePicker(show) {
    if (!hasFilter) return;
    picker.hidden = !show;
    filterButton.setAttribute("aria-expanded", show ? "true" : "false");
  }

  function renderChips() {
    chips.textContent = "";
    selected.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "label-chip sidebar-search-chip";
      chip.setAttribute("data-label-color", colorOf(name));
      chip.setAttribute("aria-label", "Remove the " + name + " filter");
      chip.textContent = name + " ×";
      chip.addEventListener("click", () => {
        setSelected(selected.filter((other) => labelKey(other) !== labelKey(name)));
        input.focus();
      });
      chips.appendChild(chip);
    });
    chips.hidden = selected.length === 0;
    filterButton.classList.toggle("is-active", selected.length > 0);
    filterCount.textContent = selected.length ? String(selected.length) : "";
    filterCount.hidden = selected.length === 0;
    picker.querySelectorAll("input").forEach((box) => {
      box.checked = selected.some((name) => labelKey(name) === labelKey(box.value));
    });
  }

  function setSelected(next) {
    selected = next;
    try {
      if (selected.length) sessionStorage.setItem(STORE_KEY, JSON.stringify(selected));
      else sessionStorage.removeItem(STORE_KEY);
    } catch (error) {
      /* storage blocked — the filter just will not outlive this page */
    }
    renderChips();
    refresh();
  }

  if (hasFilter) {
    offered.forEach((entry) => {
      const row = document.createElement("label");
      row.className = "sidebar-search-label";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = entry.name;
      box.addEventListener("change", () => {
        if (box.checked) setSelected(selected.concat([entry.name]));
        else setSelected(selected.filter((name) => labelKey(name) !== labelKey(entry.name)));
      });
      const chip = document.createElement("span");
      chip.className = entry.defined === false ? "label-chip is-orphan" : "label-chip";
      chip.setAttribute("data-label-color", entry.color || "gray");
      chip.textContent = entry.name;
      row.appendChild(box);
      row.appendChild(chip);
      picker.appendChild(row);
    });
    filterButton.hidden = false;
    filterButton.addEventListener("click", () => togglePicker(picker.hidden));
    // Restore the filter this tab last used here, minus labels since removed.
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]");
      if (Array.isArray(stored)) {
        selected = stored.filter((name) =>
          offered.some((entry) => labelKey(entry.name) === labelKey(name))
        );
      }
    } catch (error) {
      selected = [];
    }
    renderChips();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      // First press dismisses the label picker or the results, the next empties
      // the box.
      if (hasFilter && !picker.hidden) {
        togglePicker(false);
      } else if (panel.hidden) {
        input.value = "";
        lastKey = "";
        input.blur();
      } else {
        close();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (panel.hidden || !items.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      const el = items[activeIndex];
      if (panel.hidden || !el) return;
      event.preventDefault();
      window.location.href = el.href;
    }
  });

  // Keep focus in the input on mousedown, so the focusout teardown below cannot
  // remove the row between mousedown and click and swallow the navigation.
  // Safari does not focus clicked links, which is where this bites hardest.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  if (more) more.addEventListener("mousedown", (event) => event.preventDefault());

  // The path is fixed when the click is dispatched, so a control that removes
  // itself on click (a filter chip) still counts as inside; root.contains would
  // see the detached node as outside and close everything.
  document.addEventListener("click", (event) => {
    if (event.composedPath().includes(root)) return;
    close();
    togglePicker(false);
  });
  root.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) close();
    }, 0);
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    input.focus();
    input.select();
  });
})();
`;
