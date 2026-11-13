import { slugPath } from "./html.js";

/**
 * A page as a PDF (feedback #32). Download in the page's header is a menu:
 * the Markdown file (a zip of it and its images when it shows any, written by
 * page-export.ts), or the page as a PDF, which is the page printed — the
 * print stylesheet (views/styles.ts) keeps the page alone and light, and
 * whatever prints it makes the PDF: a browser's print dialog, or Crescent's
 * macOS window, which writes it into Downloads itself (shell/mac/KB25.swift).
 */

/** The page header's Download menu. */
export function downloadMenu(slug: string): string {
  return `<details class="download-menu" data-download-menu>
    <summary class="button secondary">Download</summary>
    <div class="download-menu-pop">
      <a href="/_download${slugPath(slug)}" download>Markdown (.md / .zip)</a>
      <button type="button" data-download-pdf>PDF (.pdf)</button>
    </div>
  </details>`;
}

/**
 * Gets a page ready to print, and prints it. A link to another page of the KB,
 * or to one of its files, leads nowhere once the page is a file, so it prints
 * as plain text; a link that leaves the KB, and one to a section of this page,
 * which a PDF can follow, are kept. Before a print the page starts itself, each
 * diagram is drawn again in the light theme (`__drawMermaidForPrint`), into a
 * copy only print shows, so the page on screen stays as it is.
 *
 * `kb25Print(what)` starts one: "pdf" from Download ▸ PDF, "print" from the
 * macOS window's File ▸ Print. In that window the page hands the print over
 * (`kb25Print` message) and the window calls `kb25PrintDone` once it is over;
 * a browser gets `window.print()`, under the page's own title, which its
 * dialog names the PDF after. A print the browser starts from its own menu
 * takes the links out too, but finds the diagrams as they are on screen.
 */
export const PRINT_SCRIPT = `
(() => {
  const main = document.querySelector("main.content");
  if (!main) return;
  const handlers = window.webkit && window.webkit.messageHandlers;
  const shell = handlers && handlers.kb25Print;
  const heading = main.querySelector(".page-head h1");
  const name = (heading ? heading.textContent : document.title).trim();

  function leadsNowhere(link) {
    let url;
    try { url = new URL(link.getAttribute("href"), location.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    return !(url.hash && url.pathname === location.pathname && url.search === location.search);
  }
  let unlinked = null;
  function unlink() {
    if (unlinked) return;
    unlinked = [];
    for (const link of main.querySelectorAll("a[href]")) {
      if (!leadsNowhere(link)) continue;
      unlinked.push([link, link.getAttribute("href")]);
      link.removeAttribute("href");
      link.setAttribute("data-unlinked", "");
    }
  }
  function relink() {
    if (!unlinked) return;
    for (const [link, href] of unlinked) {
      link.setAttribute("href", href);
      link.removeAttribute("data-unlinked");
    }
    unlinked = null;
  }

  let own = false;
  let title = null;
  function end() {
    relink();
    if (title !== null) document.title = title;
    title = null;
    own = false;
  }
  window.kb25PrintDone = end;
  window.kb25Print = async (what) => {
    if (own) return;
    own = true;
    unlink();
    if (typeof window.__drawMermaidForPrint === "function") {
      try { await window.__drawMermaidForPrint(); } catch (e) {}
    }
    if (shell) {
      shell.postMessage({ what: what === "print" ? "print" : "pdf", name });
      return;
    }
    title = document.title;
    document.title = name;
    let started = false;
    const start = () => { started = true; };
    addEventListener("beforeprint", start, { once: true });
    addEventListener("afterprint", end, { once: true });
    window.print();
    removeEventListener("beforeprint", start);
    // Nothing was printed, so nothing will say the print is over.
    if (!started) {
      removeEventListener("afterprint", end);
      end();
    }
  };
  addEventListener("beforeprint", () => { if (!own) unlink(); });
  addEventListener("afterprint", () => { if (!own) relink(); });

  const menu = document.querySelector("[data-download-menu]");
  if (!menu) return;
  const close = () => { menu.open = false; };
  menu.querySelector("[data-download-pdf]").addEventListener("click", () => {
    close();
    window.kb25Print("pdf");
  });
  for (const link of menu.querySelectorAll("a")) link.addEventListener("click", close);
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    event.stopPropagation();
    close();
    menu.querySelector("summary").focus();
  });
})();
`;
