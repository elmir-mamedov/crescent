/**
 * Find on this page: the bar, the matching (FIND_MODEL, which the tests run on
 * its own), and the script that drives them.
 */

/**
 * The find bar, which FIND_SCRIPT opens on Cmd/Ctrl+F. Hidden until then, and
 * for good in a browser without the Highlight API, whose own find stays.
 */
export const FIND_BAR = `<div class="find-bar" data-find role="search" aria-label="Find on this page" hidden>
  <input class="find-input" data-find-input type="text" placeholder="Find on this page" aria-label="Find on this page" autocomplete="off" spellcheck="false" enterkeyhint="search" />
  <span class="find-count" data-find-count aria-live="polite"></span>
  <button type="button" class="find-step" data-find-prev aria-label="Previous match" title="Previous match (Shift+Enter)" disabled><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg></button>
  <button type="button" class="find-step" data-find-next aria-label="Next match" title="Next match (Enter)" disabled><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></button>
  <button type="button" class="find-step" data-find-close aria-label="Close find" title="Close (Esc)"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>
</div>`;

/**
 * How find on the page (FIND_SCRIPT) compares text, as plain functions of
 * strings with no DOM in them, so that views.test.ts can run them.
 *
 * It is a plain string match that ignores case and accents and takes any run
 * of white space for one space, the way a browser's find does: "prace" finds
 * "Práce", and a phrase still matches where the page breaks its line. Curly
 * quotes and dashes, which Markdown's typographer puts in, match the straight
 * ones a keyboard types, so "don't" finds "don’t".
 */
export const FIND_MODEL = `
  const FIND_SAME = {
    "\\u2018": "'", "\\u2019": "'", "\\u201a": "'", "\\u201b": "'",
    "\\u201c": '"', "\\u201d": '"', "\\u201e": '"', "\\u201f": '"',
    "\\u2013": "-", "\\u2014": "-",
  };

  /**
   * Text as find compares it. from[i] and to[i] are where the folded text's
   * i-th character starts and ends in the original, so that a match can be
   * mapped back onto it: a letter that folds into two keeps the one span, and
   * a combining accent or a run of white space widens the span before it.
   */
  function findFold(text) {
    let folded = "";
    const from = [];
    const to = [];
    let at = 0;
    for (const ch of String(text)) {
      const next = at + ch.length;
      let base;
      if (/\\s/.test(ch)) base = " ";
      else if (Object.prototype.hasOwnProperty.call(FIND_SAME, ch)) base = FIND_SAME[ch];
      else if (ch.charCodeAt(0) < 128) base = ch.toLowerCase();
      else base = ch.normalize("NFD").replace(/\\p{M}/gu, "").toLowerCase();
      if (!base || (base === " " && folded.charAt(folded.length - 1) === " ")) {
        if (to.length) to[to.length - 1] = next;
      } else {
        for (let i = 0; i < base.length; i++) {
          folded += base.charAt(i);
          from.push(at);
          to.push(next);
        }
      }
      at = next;
    }
    return { text: folded, from: from, to: to };
  }

  /** What is typed, folded; empty when it is only white space. */
  function findQuery(raw) {
    const folded = findFold(raw).text;
    return folded.trim() ? folded : "";
  }

  /** Every match of a folded query in folded text, as [start, end) in the original. */
  function findIn(fold, query) {
    const found = [];
    if (!query) return found;
    let at = fold.text.indexOf(query);
    while (at >= 0) {
      found.push([fold.from[at], fold.to[at + query.length - 1]]);
      at = fold.text.indexOf(query, at + query.length);
    }
    return found;
  }
`;

/**
 * Find on the page (feedback #44), on FIND_MODEL above. Cmd+F (Ctrl+F off a
 * Mac) opens FIND_BAR, and what is typed there is found in the page's title,
 * its text and its "On this page" rail, and nowhere else: not the sidebar, the
 * tabs, or any of Crescent's own buttons and labels, which a browser's find
 * would match too. Enter and Shift+Enter, the bar's arrows, Cmd+G and
 * Cmd+Shift+G (F3 and Shift+F3 too) step through the matches, and Esc closes
 * it. The window's Edit menu opens it through window.kb25Find.
 *
 * Matches are drawn with the CSS Custom Highlight API, so finding changes
 * nothing in the page: NOTES_SCRIPT's marks and the rail's live entries stay as
 * they were. A browser without that API keeps its own find, because this then
 * never takes the keys. Text is read in blocks, a paragraph or a list item, so
 * a phrase matches across bold or a link but never runs from one paragraph into
 * the next; text the reader cannot see, such as the rail on a narrow window or
 * KaTeX's copy of a formula for screen readers, is not counted.
 */
export const FIND_SCRIPT = `
(() => {
  const bar = document.querySelector("[data-find]");
  const input = bar && bar.querySelector("[data-find-input]");
  if (!input || !window.CSS || !CSS.highlights || typeof Highlight !== "function") return;
${FIND_MODEL}
  const count = bar.querySelector("[data-find-count]");
  const prev = bar.querySelector("[data-find-prev]");
  const next = bar.querySelector("[data-find-next]");
  const root = document.documentElement;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const QUERY_KEY = "kb25.find";
  const SCOPE = ".page-head h1, article.prose, .toc-list";
  const SKIP = "button, input, textarea, select, script, style, template, svg, .mermaid, .katex-mathml";
  const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, caption, figcaption, summary, div, section, article, table, tr, ul, ol, dl";
  const all = new Highlight();
  const now = new Highlight();
  now.priority = 1;
  CSS.highlights.set("kb25-find", all);
  CSS.highlights.set("kb25-find-current", now);

  // The page's text by block, read again only once the page has changed.
  let blocks = null;
  let matches = [];
  let current = -1;

  function collect() {
    const found = [];
    for (const scope of document.querySelectorAll(SCOPE)) {
      const rail = scope.matches(".toc-list");
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let block = null;
      let owner = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.nodeValue || !parent || parent.closest(SKIP)) continue;
        const container = parent.closest(BLOCK) || scope;
        if (!block || container !== owner) {
          block = { rail: rail, nodes: [], starts: [], text: "" };
          owner = container;
          found.push(block);
        }
        block.nodes.push(node);
        block.starts.push(block.text.length);
        block.text += node.nodeValue;
      }
    }
    for (const block of found) block.fold = findFold(block.text);
    return found;
  }

  // The text node and offset at an offset into a block's text: the last node
  // that starts before it, or at it for the start of a match.
  function point(block, offset, end) {
    let lo = 0;
    let hi = block.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (end ? block.starts[mid] < offset : block.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return [block.nodes[lo], offset - block.starts[lo]];
  }

  // Where the window's view starts, below the tabs and this bar.
  function topEdge() {
    return bar.hidden ? 0 : bar.getBoundingClientRect().bottom + 8;
  }

  function search(keepPlace, reveal) {
    const query = findQuery(input.value);
    const anchor = keepPlace && current >= 0 ? matches[current] : null;
    matches = [];
    current = -1;
    all.clear();
    if (query) {
      if (!blocks) blocks = collect();
      const shown = new Map();
      for (const block of blocks) {
        for (const span of findIn(block.fold, query)) {
          const start = point(block, span[0], false);
          const end = point(block, span[1], true);
          const el = start[0].parentElement;
          if (!el) continue;
          if (!shown.has(el)) shown.set(el, el.getClientRects().length > 0);
          if (!shown.get(el)) continue;
          const range = document.createRange();
          try {
            range.setStart(start[0], start[1]);
            range.setEnd(end[0], end[1]);
          } catch (e) {
            continue;
          }
          matches.push({ range: range, rail: block.rail });
          all.add(range);
        }
      }
      if (matches.length) current = startAt(anchor);
    }
    show(reveal);
  }

  // The match to start on: while typing, the one in hand or the next after it;
  // otherwise the first in the text at or below the top of the view, so that
  // finding never throws the reader back to the top of a long page. The rail
  // comes after the text in the page, but "next" means the text: past its last
  // match, finding wraps to its first, and only a reader already in the rail,
  // or a query with nothing else to find, stays there.
  function startAt(anchor) {
    const first = Math.max(0, matches.findIndex((match) => !match.rail));
    if (anchor) {
      for (let i = 0; i < matches.length; i++) {
        if (matches[i].rail && !anchor.rail) break;
        try {
          if (matches[i].range.compareBoundaryPoints(Range.START_TO_START, anchor.range) >= 0) return i;
        } catch (e) {
          break;
        }
      }
      return first;
    }
    const top = topEdge();
    for (let i = 0; i < matches.length; i++) {
      if (!matches[i].rail && matches[i].range.getBoundingClientRect().bottom > top) return i;
    }
    return first;
  }

  function show(reveal) {
    now.clear();
    const asked = Boolean(findQuery(input.value));
    if (current >= 0) {
      now.add(matches[current].range);
      count.textContent = current + 1 + " of " + matches.length;
      if (reveal) bringIntoView(matches[current]);
    } else {
      count.textContent = asked ? "No matches" : "";
    }
    bar.classList.toggle("is-missing", asked && !matches.length);
    prev.disabled = next.disabled = matches.length === 0;
  }

  // Scroll the match into view, centred, through whatever scrolls around it: a
  // wide code block or table sideways, the rail inside itself, then the window.
  // Nothing moves for a match that can already be seen.
  function bringIntoView(match) {
    const range = match.range;
    const edge = topEdge();
    for (let el = range.startContainer.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
        const box = el.getBoundingClientRect();
        const at = range.getBoundingClientRect();
        const top = Math.max(box.top, edge);
        if (at.top < top || at.bottom > box.bottom) el.scrollBy(0, at.top - top - (box.bottom - top - at.height) / 2);
      }
      if (/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth) {
        const box = el.getBoundingClientRect();
        const at = range.getBoundingClientRect();
        if (at.left < box.left || at.right > box.right) el.scrollBy(at.left - box.left - (box.width - at.width) / 2, 0);
      }
    }
    // The rail stays put as the page scrolls, so the window cannot help there.
    if (match.rail) return;
    const at = range.getBoundingClientRect();
    if (at.top < edge || at.bottom > window.innerHeight - 16) {
      window.scrollBy(0, at.top - edge - (window.innerHeight - edge - at.height) / 2);
    }
  }

  function step(by) {
    if (bar.hidden) return open();
    if (!matches.length) return true;
    current = (current + by + matches.length) % matches.length;
    show(true);
    return true;
  }

  // Text selected on the page, to find instead of what was found last.
  function selected() {
    if (bar.contains(document.activeElement)) return "";
    const selection = window.getSelection();
    const text = selection && !selection.isCollapsed ? selection.toString().trim() : "";
    return text && text.length <= 200 && !/\\n/.test(text) ? text : "";
  }

  function open() {
    const wasOpen = !bar.hidden;
    const picked = selected();
    if (picked) input.value = picked;
    else if (!wasOpen && !input.value) {
      try {
        input.value = sessionStorage.getItem(QUERY_KEY) || "";
      } catch (e) {}
    }
    bar.hidden = false;
    root.classList.add("has-find");
    input.focus();
    input.select();
    if (!wasOpen || picked) {
      remember();
      search(false, true);
    }
    return true;
  }

  function close() {
    if (bar.hidden) return;
    bar.hidden = true;
    root.classList.remove("has-find");
    matches = [];
    current = -1;
    all.clear();
    now.clear();
    if (bar.contains(document.activeElement)) document.activeElement.blur();
  }

  function remember() {
    try {
      sessionStorage.setItem(QUERY_KEY, input.value);
    } catch (e) {}
  }

  input.addEventListener("input", () => {
    remember();
    search(true, true);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  });
  bar.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  // A click on the arrows leaves the caret in the field, so typing goes on.
  bar.addEventListener("mousedown", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  });
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  bar.querySelector("[data-find-close]").addEventListener("click", close);

  // Ctrl+F stays the text fields' own on a Mac, where it moves the caret on.
  document.addEventListener("keydown", (event) => {
    const f3 = event.key === "F3" && !event.metaKey && !event.ctrlKey && !event.altKey;
    const held = (mac ? event.metaKey : event.ctrlKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (!f3 && !(held && (key === "g" || (key === "f" && !event.shiftKey)))) return;
    // A dialog over the page has it, and the page beneath has nothing to show.
    if (document.querySelector("dialog:modal")) return;
    event.preventDefault();
    if (key === "f") open();
    else step(event.shiftKey ? -1 : 1);
  });

  // The page changing under the bar, or the rail showing or hiding with the
  // window's width or the chat, finds again where it was.
  let pending = 0;
  function refresh() {
    blocks = null;
    if (bar.hidden || pending) return;
    pending = window.setTimeout(() => {
      pending = 0;
      if (!bar.hidden) search(true, false);
    }, 150);
  }
  const observer = new MutationObserver(refresh);
  for (const scope of document.querySelectorAll(SCOPE)) {
    observer.observe(scope, { childList: true, characterData: true, subtree: true });
  }
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", refresh);

  window.kb25Find = (action) => (action === "next" ? step(1) : action === "previous" ? step(-1) : open());
})();
`;
