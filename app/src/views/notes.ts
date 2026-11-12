/**
 * The script behind inline notes: it draws the notes saved on a page and turns
 * a text selection into a new one.
 */

/**
 * Inline notes on the rendered page: draw the ones already saved, and let a text
 * selection become a new one.
 *
 * The renderer stamps each top-level block with `data-src-line` / `data-src-hash`
 * and lists the ids of the notes attached to it in `data-kb25-notes`; the notes
 * themselves arrive as JSON on `#kb25-notes`. Everything here is built with
 * `createElement` and text nodes — never `innerHTML` — because note text comes
 * from a file a person or an agent can write anything into.
 *
 * Note that every `\\s` below is doubled: this is a template literal, so a lone
 * backslash would be eaten and `/\s+/` would silently become `/s+/`.
 */
export const NOTES_SCRIPT = `
(() => {
  const article = document.querySelector("article.prose");
  const payload = document.getElementById("kb25-notes");
  if (!article || !payload) return;

  const slug = payload.getAttribute("data-slug") || "";
  let notes = [];
  try {
    notes = JSON.parse(payload.getAttribute("data-notes") || "[]");
  } catch (err) {
    notes = [];
  }

  const byId = new Map(notes.map((note) => [note.id, note]));

  /** Collapse whitespace the same way the server does, so quotes still match. */
  function normalize(text) {
    return text.replace(/\\s+/g, " ").trim();
  }

  function relativeTime(iso) {
    const then = Date.parse(iso);
    if (!then) return "";
    const seconds = Math.max(0, (Date.now() - then) / 1000);
    const steps = [[60, "s"], [60, "m"], [24, "h"], [7, "d"], [52, "w"]];
    let value = seconds;
    let unit = "s";
    for (const [size, name] of steps) {
      if (value < size) break;
      value = value / size;
      unit = name;
    }
    return Math.floor(value) + unit + " ago";
  }

  // --- painting saved notes ------------------------------------------------

  /**
   * Wrap a note's quote in <mark>. The quote can straddle <strong>/<a>
   * boundaries, and no single element can wrap across those, so this indexes
   * every text node into one collapsed string, finds the quote there, then
   * splits and wraps each text node the match touches — one <mark> per node.
   * Returns false when the quote is gone, so the caller can degrade instead of
   * throwing.
   */
  function markQuote(block, note) {
    const wanted = normalize(note.quote);
    if (!wanted) return false;

    // Collect the whole walk before mutating: splitText() inserts siblings the
    // walker has already passed, which would otherwise be revisited.
    const nodes = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Mermaid re-reads its source from textContent on every theme flip, so
      // that text has to stay one intact node.
      if (node.parentElement && node.parentElement.closest("pre.mermaid")) continue;
      nodes.push(node);
    }

    // text[i] came from nodes[owner[i]] at character offset[i]. A run of
    // whitespace collapses onto the single space that starts it, so every
    // emitted character keeps exactly one source position.
    let text = "";
    const owner = [];
    const offset = [];
    for (let i = 0; i < nodes.length; i++) {
      const value = nodes[i].nodeValue;
      for (let j = 0; j < value.length; j++) {
        const isSpace = /\\s/.test(value[j]);
        if (isSpace && (text === "" || text.charCodeAt(text.length - 1) === 32)) continue;
        text += isSpace ? " " : value[j];
        owner.push(i);
        offset.push(j);
      }
    }

    const at = text.indexOf(wanted);
    if (at < 0) return false;

    // Group the matched characters back into one run per text node. Offsets
    // within a node only increase, so extending the last run is enough.
    const runs = [];
    for (let k = at; k < at + wanted.length; k++) {
      const last = runs.length ? runs[runs.length - 1] : null;
      if (last && last.node === owner[k]) last.end = offset[k] + 1;
      else runs.push({ node: owner[k], start: offset[k], end: offset[k] + 1 });
    }

    let marked = false;
    for (const run of runs) {
      const node = nodes[run.node];
      const length = node.nodeValue.length;
      if (run.start >= length) continue;
      const end = Math.min(run.end, length);
      // Split the head off first, then the tail, leaving exactly the match.
      const middle = run.start > 0 ? node.splitText(run.start) : node;
      if (end - run.start < middle.nodeValue.length) middle.splitText(end - run.start);
      const mark = document.createElement("mark");
      // The kind rides on the highlight itself: a task asks for a change and is
      // coloured for it, a remark is only context.
      mark.className = "note-mark is-" + note.kind;
      mark.setAttribute("data-note-mark", note.id);
      middle.parentNode.insertBefore(mark, middle);
      mark.appendChild(middle);
      marked = true;
    }
    return marked;
  }

  /**
   * Where a block's pin can legally live. A <button> is not valid as a direct
   * child of <ul>/<ol>, so it goes in the first item instead — which changes
   * nothing about where it appears, because the pin positions against the
   * nearest positioned ancestor and that is still the block. A table's block is
   * the .table-wrap around it, which takes the pin directly.
   */
  function pinHost(block) {
    const tag = block.tagName;
    if (tag === "UL" || tag === "OL") return block.querySelector("li") || block;
    return block;
  }

  /** The gutter pin for a block, created on first use. */
  function pinFor(block) {
    let pin = block.querySelector(".note-pin");
    if (pin) return pin;
    pin = document.createElement("button");
    pin.type = "button";
    pin.className = "note-pin";
    pin.setAttribute("data-note-pin", "");
    const host = pinHost(block);
    host.insertBefore(pin, host.firstChild);
    return pin;
  }

  function paint() {
    const blocks = article.querySelectorAll("[data-kb25-notes]");
    for (const block of blocks) {
      const ids = (block.getAttribute("data-kb25-notes") || "").split(" ").filter(Boolean);
      const present = ids.filter((id) => byId.has(id));
      if (!present.length) continue;

      block.classList.add("has-note");
      const kinds = present.map((id) => byId.get(id).kind);
      // One pin stands for every note on the block, so the loudest kind on it
      // wins: a single task among remarks still means something is waiting, an
      // agent note outranks a remark because it is something new said by whoever
      // last changed the page, and a highlight only colours the pin when nothing
      // else does.
      const loudest = kinds.includes("task")
        ? "task"
        : kinds.includes("agent")
          ? "agent"
          : kinds.includes("remark")
            ? "remark"
            : "highlight";
      const pin = pinFor(block);
      pin.classList.toggle("is-task", loudest === "task");
      pin.classList.toggle("is-agent", loudest === "agent");
      pin.classList.toggle("is-remark", loudest === "remark");
      pin.classList.toggle("is-highlight", loudest === "highlight");
      pin.setAttribute("aria-label", present.length + " note" + (present.length === 1 ? "" : "s"));
      pin.title = present.length === 1 ? "1 note" : present.length + " notes";

      for (const id of present) {
        const note = byId.get(id);
        if (note.quote && !markQuote(block, note)) note.drifted = true;
      }
    }
  }

  /** Take every note off the page again, leaving the prose as it was rendered. */
  function unpaint() {
    for (const pin of article.querySelectorAll("[data-note-pin]")) pin.remove();
    // Outer marks come first in document order, so a mark inside another is
    // still in the page, in the outer one's place, when its turn comes.
    const parents = new Set();
    for (const mark of article.querySelectorAll("[data-note-mark]")) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parents.add(parent);
    }
    // Join the text that marking split, so the page has the nodes it came with.
    for (const parent of parents) parent.normalize();
    for (const block of article.querySelectorAll(".has-note")) block.classList.remove("has-note");
  }

  // --- the controls shared by writing and rewriting --------------------------

  /**
   * The three kinds, in the order the switch offers them and with the tooltip
   * each one carries. Highlight leads and is the default because marking a
   * passage is the most common thing to want and the only one that asks for
   * nothing: no words, no work for anyone reading the page later.
   */
  const KINDS = [
    ["highlight", "Highlight", "Marks the phrase — nothing to write"],
    ["remark", "Remark", "Context, not an instruction"],
    ["task", "Task", "Something an agent should change"],
  ];

  /**
   * What each kind is called on a card. Read from here rather than from KINDS,
   * because that table is what the switch *offers* and an agent note is the one
   * kind nobody can write: it needs a name without becoming an option.
   */
  const LABELS = { highlight: "Highlight", remark: "Remark", task: "Task", agent: "Agent" };

  /** A kind's label, falling back to Task the way the parser does. */
  function kindLabel(kind) {
    return LABELS[kind] || "Task";
  }

  /** What the text box asks for, which is nothing at all for a highlight. */
  function placeholderFor(kind) {
    if (kind === "highlight") return "Optional — a highlight needs no words";
    if (kind === "remark") return "Context worth keeping";
    return "What should change here?";
  }

  /**
   * The Highlight/Remark/Task switch. The composer and the in-place editor share
   * it, so a note can be re-typed as another kind with the same three words it
   * was first typed with. Callers read the kind() getter when they submit rather
   * than tracking the choice themselves; onChange exists only so the text box can
   * say whether it still needs filling in.
   */
  function kindPicker(current, onChange) {
    const element = document.createElement("div");
    element.className = "note-kinds";
    let kind = KINDS.some((option) => option[0] === current) ? current : "task";
    for (const option of KINDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "note-kind-option is-" + option[0] + (option[0] === kind ? " is-selected" : "");
      button.textContent = option[1];
      button.title = option[2];
      button.addEventListener("click", () => {
        kind = option[0];
        for (const sibling of element.children) {
          sibling.classList.toggle("is-selected", sibling === button);
        }
        if (onChange) onChange(kind);
      });
      element.appendChild(button);
    }
    return { element: element, kind: () => kind };
  }

  /** The note text box, prefilled when an existing note is being rewritten. */
  function noteField(text, kind) {
    const field = document.createElement("textarea");
    field.className = "note-input";
    field.rows = 3;
    field.value = text;
    field.placeholder = placeholderFor(kind);
    return field;
  }

  function actionButton(label, tone) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button " + tone;
    button.textContent = label;
    return button;
  }

  // --- the note popover ----------------------------------------------------

  let popover = null;
  let popoverAnchor = null;

  function closePopover() {
    if (!popover) return;
    popover.remove();
    popover = null;
    popoverAnchor = null;
    const active = article.querySelectorAll(".note-mark.is-active");
    for (const mark of active) mark.classList.remove("is-active");
  }

  /**
   * A note's words, with the links in them as real links.
   *
   * The server ships a note that has links as segments — runs of plain text and
   * runs that are one — with every [[wiki-link]] already resolved to where it
   * points now. A note without any ships none and is drawn as one string. Both
   * paths reach the DOM through createElement and text nodes, so a note can
   * carry a link without being able to carry markup.
   */
  function paintNoteText(target, note) {
    if (!note.segments) {
      target.textContent = note.text;
      return;
    }
    for (const segment of note.segments) {
      if (!segment.href) {
        target.appendChild(document.createTextNode(segment.text));
        continue;
      }
      const link = document.createElement("a");
      link.href = segment.href;
      link.textContent = segment.text;
      target.appendChild(link);
    }
  }

  /**
   * One note in the popover, drawn either for reading or for editing its text
   * and kind in place. Both modes come from the same function so the head —
   * kind, age, author — is identical either way and only the part below it
   * swaps; editing a note is not a different panel, it is the same card.
   */
  function noteCard(note) {
    const card = document.createElement("div");
    card.className = "note-card";

    const head = () => {
      const row = document.createElement("div");
      row.className = "note-card-head";
      const kind = document.createElement("span");
      kind.className = "note-kind is-" + note.kind;
      kind.textContent = kindLabel(note.kind);
      row.appendChild(kind);
      const when = document.createElement("span");
      when.className = "note-when";
      // The pink chip already names an agent as the writer, so printing its
      // by= line beside it would only say the same word twice.
      const by = note.kind === "agent" ? "" : note.by;
      when.textContent = [relativeTime(note.at), by].filter(Boolean).join(" · ");
      row.appendChild(when);
      return row;
    };

    const draw = (editing) => {
      card.textContent = "";
      card.appendChild(head());

      // A quote is shown here only when it could not be highlighted in the prose,
      // where it would otherwise be the one thing pointing at what drifted.
      if (note.quote && note.drifted) {
        const quote = document.createElement("div");
        quote.className = "note-quote";
        quote.textContent = "\\u201c" + note.quote + "\\u201d";
        card.appendChild(quote);
      }

      const actions = document.createElement("div");
      actions.className = "note-card-actions";

      if (editing) {
        const field = noteField(note.text, note.kind);
        card.appendChild(field);

        const picker = kindPicker(note.kind, (kind) => {
          field.placeholder = placeholderFor(kind);
        });
        actions.appendChild(picker.element);

        const cancel = actionButton("Cancel", "secondary");
        cancel.addEventListener("click", (event) => swap(false, event));
        actions.appendChild(cancel);

        const save = actionButton("Save", "primary");
        const submit = () => {
          const text = field.value.trim();
          // A highlight is the mark itself, so it is the one kind that saves with
          // an empty box — including a task or remark retyped into one, which
          // drops the words it no longer needs.
          if (!text && picker.kind() !== "highlight") {
            field.focus();
            return;
          }
          save.disabled = true;
          send({ op: "edit", noteId: note.id, text: text, kind: picker.kind() }, save);
        };
        save.addEventListener("click", submit);
        actions.appendChild(save);

        card.appendChild(actions);
        field.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          // Escape backs out of the editor and nothing more — swap() keeps the
          // keypress from the document handler, which would close the popover.
          if (event.key === "Escape") swap(false, event);
        });
        field.focus();
        return;
      }

      // A highlight has no words of its own — the mark in the prose is the whole
      // note — so the card shows its head and its actions and nothing between.
      if (note.text) {
        const body = document.createElement("div");
        body.className = "note-text";
        paintNoteText(body, note);
        card.appendChild(body);
      }

      // A note from an agent is the agent's own words: it can be taken down but
      // not have words put in its mouth, so it gets no Edit. The route refuses
      // one too — this only keeps the button from promising what it can't do.
      if (note.kind !== "agent") {
        const edit = actionButton("Edit", "secondary");
        edit.addEventListener("click", (event) => swap(true, event));
        actions.appendChild(edit);
      }

      const resolve = actionButton("Resolve", "secondary");
      resolve.addEventListener("click", () => {
        resolve.disabled = true;
        send({ op: "resolve", noteId: note.id }, resolve);
      });
      actions.appendChild(resolve);

      // The note's handle for a chat (feedback #45), the same one the tasks
      // dashboard copies: COPY_LINK_SCRIPT copies it and says so.
      const ref = slug + "#" + note.id;
      const copy = actionButton("Copy ID", "secondary");
      copy.setAttribute("data-copy-slug", ref);
      copy.setAttribute("data-copy-label", "Note ID");
      copy.title = "Copy note ID \\u2014 " + ref;
      actions.appendChild(copy);

      card.appendChild(actions);
    };

    /**
     * Change mode, then re-pin the popover for the height it now wants.
     *
     * The click that got us here is stopped short of the document: redrawing
     * detaches the very button that was clicked, and the outside-click handler
     * would then find no popover above that orphan and close the card out from
     * under the editor it just opened.
     */
    const swap = (editing, event) => {
      if (event) event.stopPropagation();
      draw(editing);
      reposition();
    };

    draw(false);
    return card;
  }

  function openPopover(anchor, ids) {
    closePopover();
    const shown = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!shown.length) return;

    popover = document.createElement("div");
    popover.className = "note-popover";
    popover.setAttribute("role", "dialog");
    for (const note of shown) popover.appendChild(noteCard(note));
    // An agent's note offers to take down all of the agent's notes on the page
    // at once (feedback #46), when there is more than the one.
    const agentIds = notes.filter((note) => note.kind === "agent").map((note) => note.id);
    if (agentIds.length > 1 && shown.some((note) => note.kind === "agent")) {
      const foot = document.createElement("div");
      foot.className = "note-popover-foot";
      const all = actionButton("Resolve all " + agentIds.length + " agent notes", "secondary");
      all.setAttribute("data-note-resolve-agents", "");
      all.title = "Take down every note the agent left on this page";
      all.addEventListener("click", () => {
        all.disabled = true;
        send({ op: "resolve-agent", noteIds: agentIds.join(" ") }, all);
      });
      foot.appendChild(all);
      popover.appendChild(foot);
    }
    popoverAnchor = anchor;
    document.body.appendChild(popover);
    place(popover, anchor.getBoundingClientRect());
  }

  /**
   * Re-pin the popover after a card changed height. The editor is taller than
   * the note it replaces, so a popover that opened low in the window would
   * otherwise grow off the bottom of it.
   */
  function reposition() {
    if (popover && popoverAnchor) place(popover, popoverAnchor.getBoundingClientRect());
  }

  /** Pin a fixed-position panel under a rect, kept inside the viewport. */
  function place(panel, rect) {
    const width = panel.offsetWidth;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const below = rect.bottom + 8;
    const fitsBelow = below + panel.offsetHeight < window.innerHeight - 12;
    const top = fitsBelow ? below : rect.top - panel.offsetHeight - 8;
    // Neither side always fits — a note low in the window with its editor open
    // is the tall case — so the panel is pulled back inside the viewport rather
    // than left hanging over an edge.
    const lowest = Math.max(12, window.innerHeight - panel.offsetHeight - 12);
    panel.style.left = left + "px";
    panel.style.top = Math.max(12, Math.min(top, lowest)) + "px";
  }

  // --- writing ---------------------------------------------------------------

  function send(fields, button) {
    const body = new URLSearchParams(fields);
    fetch("/_notes/" + slug, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
      .then((response) => {
        // A session that expired redirects to the login page; reloading lands
        // the reader there rather than failing silently.
        if (response.redirected) {
          window.location.reload();
          return null;
        }
        return response.json().catch(() => ({ ok: false, error: "Could not save the note." }));
      })
      .then((result) => {
        if (!result) return;
        if (result.ok) refresh();
        else fail(result.error || "Could not save the note.", button);
      })
      .catch(() => fail("Could not reach the server.", button));
  }

  /**
   * Show the notes as they are after a write, without reloading the page
   * (feedback #50): a reload blinked the whole page to change one mark. The
   * page is fetched again and only what a note changes is taken from it: each
   * block's source line and the notes on it, the notes themselves, and when
   * the page was last updated. A page whose blocks no longer line up with the
   * ones shown, because something else changed it too, is reloaded instead.
   */
  function refresh() {
    fetch(location.href, { cache: "no-store" })
      .then((response) => (response.ok && !response.redirected ? response.text() : null))
      .then((html) => {
        if (html === null || !adopt(new DOMParser().parseFromString(html, "text/html"))) {
          window.location.reload();
        }
      })
      .catch(() => window.location.reload());
  }

  /** Take the notes from \`next\`, a fresh copy of this page; false if it no longer fits. */
  function adopt(next) {
    const nextArticle = next.querySelector("article.prose");
    const nextPayload = next.getElementById("kb25-notes");
    if (!nextArticle || !nextPayload) return false;
    // A block's fingerprint leaves its notes out, so only another change to
    // the page tells these apart.
    const blocks = article.querySelectorAll("[data-src-hash]");
    const nextBlocks = nextArticle.querySelectorAll("[data-src-hash]");
    if (blocks.length !== nextBlocks.length) return false;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].getAttribute("data-src-hash") !== nextBlocks[i].getAttribute("data-src-hash")) return false;
    }
    const nextData = nextPayload.getAttribute("data-notes") || "[]";
    let nextNotes;
    try {
      nextNotes = JSON.parse(nextData);
    } catch (err) {
      return false;
    }

    // What the reload used to close: the card or composer the write came
    // from, and the selection the new note was made from.
    closePopover();
    closeComposer();
    hideAddButton();
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    unpaint();
    blocks.forEach((block, i) => {
      const from = nextBlocks[i];
      block.setAttribute("data-src-line", from.getAttribute("data-src-line") || "");
      const ids = from.getAttribute("data-kb25-notes");
      if (ids) block.setAttribute("data-kb25-notes", ids);
      else block.removeAttribute("data-kb25-notes");
    });
    payload.setAttribute("data-notes", nextData);
    notes = nextNotes;
    byId.clear();
    for (const note of notes) byId.set(note.id, note);
    paint();

    const stamp = document.querySelector(".page-head .updated");
    const nextStamp = next.querySelector(".page-head .updated");
    if (stamp && nextStamp) stamp.textContent = nextStamp.textContent;
    return true;
  }

  function fail(message, button) {
    if (button) button.disabled = false;
    const toast = document.createElement("div");
    toast.className = "toast is-error";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 320);
    }, 3200);
  }

  // --- composing from a selection --------------------------------------------

  let pending = null;
  let addButton = null;
  let composer = null;

  /**
   * The current selection as an anchor, or null. A selection is clipped to the
   * block that holds its start: a quote spanning two blocks is text no single
   * block contains, so it could never be found again.
   */
  function selectionAnchor() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return null;

    let node = range.startContainer;
    if (node.nodeType === 1 && range.startOffset < node.childNodes.length) {
      node = node.childNodes[range.startOffset];
    }
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    const block = element && element.closest ? element.closest("[data-src-line]") : null;
    if (!block || !article.contains(block)) return null;

    const clipped = range.cloneRange();
    if (!block.contains(clipped.startContainer)) clipped.setStart(block, 0);
    if (!block.contains(clipped.endContainer)) clipped.setEnd(block, block.childNodes.length);

    const quote = normalize(clipped.toString());
    if (!quote) return null;

    return {
      line: block.getAttribute("data-src-line"),
      hash: block.getAttribute("data-src-hash"),
      quote: quote,
      rect: clipped.getBoundingClientRect(),
    };
  }

  function hideAddButton() {
    if (addButton) addButton.remove();
    addButton = null;
  }

  function showAddButton(anchor) {
    hideAddButton();
    addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "note-add";
    addButton.textContent = "Add note";
    // Without this the button's own mousedown collapses the selection before
    // the click handler ever sees it.
    addButton.addEventListener("mousedown", (event) => event.preventDefault());
    addButton.addEventListener("click", () => openComposer(anchor));
    document.body.appendChild(addButton);
    place(addButton, anchor.rect);
  }

  function closeComposer() {
    if (composer) composer.remove();
    composer = null;
  }

  function openComposer(anchor) {
    hideAddButton();
    closeComposer();
    closePopover();

    composer = document.createElement("div");
    composer.className = "note-composer";

    const quote = document.createElement("div");
    quote.className = "note-quote";
    quote.textContent = "\\u201c" + anchor.quote + "\\u201d";
    composer.appendChild(quote);

    const field = noteField("", "highlight");
    composer.appendChild(field);

    const row = document.createElement("div");
    row.className = "note-composer-actions";

    const picker = kindPicker("highlight", (kind) => {
      field.placeholder = placeholderFor(kind);
    });
    row.appendChild(picker.element);

    const cancel = actionButton("Cancel", "secondary");
    cancel.addEventListener("click", closeComposer);
    row.appendChild(cancel);

    const save = actionButton("Save", "primary");
    const submit = () => {
      const text = field.value.trim();
      // Highlight is the default kind, so Save straight after selecting a phrase
      // marks it and nothing else — which is the point of having the kind.
      if (!text && picker.kind() !== "highlight") {
        field.focus();
        return;
      }
      save.disabled = true;
      send(
        {
          op: "add",
          line: anchor.line,
          hash: anchor.hash,
          quote: anchor.quote,
          text: text,
          kind: picker.kind(),
        },
        save
      );
    };
    save.addEventListener("click", submit);
    row.appendChild(save);

    composer.appendChild(row);
    // Cmd/Ctrl+Enter saves, matching the editor's Cmd/Ctrl+S habit.
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
      if (event.key === "Escape") closeComposer();
    });

    document.body.appendChild(composer);
    place(composer, anchor.rect);
    field.focus();
  }

  // --- arriving at one particular note ---------------------------------------

  /**
   * Open the note named by a \`#note-<id>\` fragment, which is how the dashboard
   * links to a single task rather than to the top of its page.
   *
   * The anchor is found by walking the candidates and splitting their attribute,
   * the way paint() does, rather than with a \`~=\` selector: a hand-written note
   * gets a positional \`@<line>\` id, which would need escaping to be a valid one.
   * A note that is already resolved leaves the page alone.
   */
  function focusFromHash() {
    // A real element with this id wins. Heading ids share the fragment
    // namespace with \`#note-<id>\`, so a heading called "Note 3f2a91bc" has to
    // scroll to itself rather than open a note that happens to share the tail.
    if (location.hash.length > 1 && document.getElementById(location.hash.slice(1))) return;
    const raw = (location.hash || "").replace(/^#note-/, "");
    if (!raw || raw === location.hash) return;
    // A positional \`@<line>\` id arrives percent-encoded, so the fragment has to
    // be decoded before it can be looked up.
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch (err) {
      id = raw;
    }
    if (!byId.has(id)) return;

    let anchor = null;
    for (const mark of article.querySelectorAll("[data-note-mark]")) {
      if (mark.getAttribute("data-note-mark") === id) {
        anchor = mark;
        break;
      }
    }
    if (anchor) {
      for (const mark of article.querySelectorAll("[data-note-mark]")) {
        if (mark.getAttribute("data-note-mark") === id) mark.classList.add("is-active");
      }
    } else {
      for (const block of article.querySelectorAll("[data-kb25-notes]")) {
        const ids = (block.getAttribute("data-kb25-notes") || "").split(" ").filter(Boolean);
        if (ids.indexOf(id) >= 0) {
          anchor = block.querySelector(".note-pin");
          break;
        }
      }
    }
    if (!anchor) return;

    anchor.scrollIntoView({ block: "center" });
    // After the scroll, so the popover is placed against the rect the anchor
    // ends up with rather than the one it was at.
    openPopover(anchor, [id]);
  }

  // --- wiring ----------------------------------------------------------------

  paint();
  focusFromHash();
  window.addEventListener("hashchange", focusFromHash);

  function offerSelection() {
    if (composer) return; // the composer owns the selection it was opened with
    pending = selectionAnchor();
    if (pending) showAddButton(pending);
    else hideAddButton();
  }

  // The button waits for the mouse to come up. Shown mid-drag, it sat right in
  // the path of a downward drag, and the pointer crossing it moved the
  // selection's end to where the button is in the document — the end of
  // <body> — so the selection flooded to the bottom of the page and back on
  // every move. A keyboard selection has no drag and still shows it at once.
  let dragging = false;

  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".note-add")) return;
    dragging = true;
    hideAddButton();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    offerSelection();
  });
  // Dragging selected text away ends in dragend, with no mouseup.
  document.addEventListener("dragend", () => {
    dragging = false;
  });

  document.addEventListener("selectionchange", () => {
    if (!dragging) offerSelection();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".note-popover, .note-composer, .note-add")) return;

    const pin = target.closest("[data-note-pin]");
    if (pin) {
      const block = pin.closest("[data-kb25-notes]");
      const ids = (block.getAttribute("data-kb25-notes") || "").split(" ").filter(Boolean);
      openPopover(pin, ids);
      return;
    }

    const mark = target.closest("[data-note-mark]");
    if (mark) {
      const id = mark.getAttribute("data-note-mark");
      const marks = article.querySelectorAll('[data-note-mark="' + id + '"]');
      for (const sibling of marks) sibling.classList.add("is-active");
      openPopover(mark, [id]);
      return;
    }

    closePopover();
    closeComposer();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closePopover();
    closeComposer();
    hideAddButton();
  });
})();
`;
