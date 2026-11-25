/**
 * Collapsible sections: the `:::details Title` blocks the renderer turns into
 * `<details class="details-block">` (markdown.ts). The browser opens and closes
 * them on its own; this script opens one whenever something the reader asked
 * for is inside it while it is closed, where it could not be seen:
 *
 * - the section an address names, as the page opens and on every hash change,
 *   and the one a link into this page leads to, before the browser scrolls;
 * - a match find on the page steps to (FIND_SCRIPT calls `kb25Reveal`).
 *
 * Print opens every one, and closes them again after (PRINT_SCRIPT), since a
 * closed section's text is not on paper either.
 */
export const DETAILS_SCRIPT = `
(() => {
  const article = document.querySelector("article.prose");
  if (!article) return;

  // Opens every closed section around el. Returns whether it opened any.
  window.kb25Reveal = (el) => {
    let opened = false;
    for (let at = el && el.parentElement; at && at !== article; at = at.parentElement) {
      if (at.tagName === "DETAILS" && !at.open) {
        at.open = true;
        opened = true;
      }
    }
    return opened;
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
