import { IMAGE_ACCEPT } from "../gallery.js";
import { escapeHtml } from "./html.js";

/**
 * The chat drawer: the corner button that opens it, its markup, and the script
 * that runs a conversation with the person's Claude Code or Codex (chat.ts on the
 * server).
 */

/** Sparkles in the top-right corner that open and close the chat drawer. */
export const CHAT_BUTTON = `<button type="button" class="chat-button" data-chat-open aria-expanded="false" aria-label="Chat" title="Chat — ask a question, or ask for a page">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" /><path d="M20 3v4M22 5h-4M4 17v2M5 18H3" /></svg>
  </button>`;

/**
 * The chat drawer, on every page with the corner. `slug` is the page being
 * viewed, sent with each message so "this page" means something to Claude.
 * The drawer starts hidden; CHAT_SCRIPT opens it before first paint when it
 * was open on the last page, so moving between pages does not make it jump.
 * Images go with a message from the paperclip under the box, or dropped
 * anywhere on the drawer.
 */
export function chatDrawer(slug: string): string {
  return `<section class="chat-drawer" data-chat data-chat-slug="${escapeHtml(slug)}" aria-label="Chat" hidden>
  <div class="chat-head">
    <h2 class="chat-title" data-chat-title>New chat</h2>
    <span class="chat-engine" data-chat-engine hidden></span>
    <button type="button" class="chat-icon-button" data-chat-history-open aria-label="Earlier chats" title="Earlier chats">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    <button type="button" class="chat-icon-button" data-chat-new aria-label="New chat" title="New chat">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <button type="button" class="chat-icon-button" data-chat-close aria-label="Close chat" title="Close chat">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
  <div class="chat-history" data-chat-history hidden></div>
  <div class="chat-setup" data-chat-setup hidden></div>
  <div class="chat-log" data-chat-log></div>
  <div class="chat-activity" data-chat-activity role="status" hidden></div>
  <div class="chat-drop" data-chat-drop hidden>Drop images to attach them</div>
  <form class="chat-form" data-chat-form>
    <div class="chat-composer">
      <div class="chat-attachments" data-chat-attachments hidden></div>
      <textarea class="chat-input" data-chat-input rows="1" aria-label="Message" placeholder="Ask anything, or ask for a page…"></textarea>
      <div class="chat-toolbar">
        <button type="button" class="chat-icon-button" data-chat-attach aria-label="Attach images" title="Attach images, or drop them onto the chat">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
        </button>
        <input type="file" data-chat-file accept="${IMAGE_ACCEPT}" multiple hidden />
        <label class="chat-pages" title="Write the answer into the knowledge base as pages, not into the chat"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z" /></svg><input type="checkbox" data-chat-pages /> Write to KB</label>
        <button type="button" class="chat-send chat-stop" data-chat-stop aria-label="Stop" title="Stop" hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
        </button>
        <button type="submit" class="chat-send" data-chat-send aria-label="Send" title="Send">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
        </button>
      </div>
    </div>
    <div class="chat-meta chat-run" data-chat-run hidden>
      <div class="chat-engines" data-chat-engines role="radiogroup" aria-label="Run this chat on" hidden></div>
      <select class="chat-select" data-chat-model aria-label="Model" title="The model the next message runs on"></select>
      <select class="chat-select" data-chat-effort aria-label="Effort" title="How much the model thinks before it answers"></select>
    </div>
  </form>
</section>`;
}

/**
 * The drawer's behaviour. A turn runs on the server (chat.ts), so this only
 * shows threads and follows a turn's event stream: a page that loads mid-turn
 * shows the thread so far, then attaches to the stream, which replays the turn
 * from its question. Server text goes in as text. A reply is the one piece of
 * HTML: the server rendered it from Markdown with raw HTML off, and it is
 * parsed with DOMParser, whose documents never run scripts, then moved in.
 *
 * An attached image is sent as it is, for the agent to put on a page, along
 * with a smaller JPEG drawn from it here, which is what the model is shown:
 * the server has no way to shrink an image, and a screenshot is often more
 * than Claude takes.
 */
export const CHAT_SCRIPT = `
(() => {
  const drawer = document.querySelector("[data-chat]");
  const toggle = document.querySelector("[data-chat-open]");
  if (!drawer || !toggle) return;
  const $ = (sel) => drawer.querySelector(sel);
  const log = $("[data-chat-log]");
  const setup = $("[data-chat-setup]");
  const history = $("[data-chat-history]");
  const activity = $("[data-chat-activity]");
  const form = $("[data-chat-form]");
  const input = $("[data-chat-input]");
  const pages = $("[data-chat-pages]");
  const sendBtn = $("[data-chat-send]");
  const stopBtn = $("[data-chat-stop]");
  const titleEl = $("[data-chat-title]");
  const engineLabel = $("[data-chat-engine]");
  const enginePicker = $("[data-chat-engines]");
  const runRow = $("[data-chat-run]");
  const modelPicker = $("[data-chat-model]");
  const effortPicker = $("[data-chat-effort]");
  const attachButton = $("[data-chat-attach]");
  const fileInput = $("[data-chat-file]");
  const strip = $("[data-chat-attachments]");
  const dropZone = $("[data-chat-drop]");
  const slug = drawer.dataset.chatSlug || "";

  const saved = {
    get(key) {
      try { return localStorage.getItem("kb25.chat." + key); } catch { return null; }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem("kb25.chat." + key);
        else localStorage.setItem("kb25.chat." + key, value);
      } catch {}
    },
  };

  // The message being written survives going to another page, which is a
  // page load that starts the drawer over: its text is saved with the rest
  // ("draft"), and its images, which localStorage cannot hold, as the files
  // themselves in IndexedDB. Where IndexedDB is out of reach (a private
  // window, say) the images are simply not kept, as before.
  const draftImages = (() => {
    let db = null;
    const open = () => {
      if (!db) {
        db = new Promise((resolve) => {
          try {
            const req = indexedDB.open("kb25.chat", 1);
            req.onupgradeneeded = () => req.result.createObjectStore("draft");
            req.onsuccess = () => resolve(req.result);
            req.onerror = req.onblocked = () => resolve(null);
          } catch {
            resolve(null);
          }
        });
      }
      return db;
    };
    // Each call opens its transaction in the order it was made, so saves
    // land in order however quickly they follow one another.
    const run = async (mode, act) => {
      const store = await open();
      if (!store) return undefined;
      return new Promise((resolve) => {
        try {
          const tx = store.transaction("draft", mode);
          const req = act(tx.objectStore("draft"));
          tx.oncomplete = () => resolve(req.result);
          tx.onerror = tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    };
    return {
      get: () => run("readonly", (store) => store.get("images")),
      set: (files) =>
        run("readwrite", (store) =>
          files.length
            ? store.put(files.map((file) => ({ name: file.name, type: file.type, blob: file })), "images")
            : store.delete("images")
        ),
    };
  })();

  let threadId = saved.get("thread");
  let source = null;
  let streaming = null;
  let busy = false;
  let loaded = false;
  // Every engine and its state, from /_chat/status; and the open thread's
  // engine, or null while the chat is new and its engine can still be picked.
  let engines = [];
  let threadEngine = null;
  // The images going with the next message: each file, a URL to show it by,
  // and the copy for the model (a promise of a JPEG, or of null).
  let attachments = [];
  const MAX_IMAGES = 10;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // crypto.randomUUID needs a secure context, which a LAN host over plain
  // HTTP is not; the fallback builds the same shape from random bytes.
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  async function getJson(url) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  function setOpen(open) {
    document.body.classList.toggle("chat-open", open);
    drawer.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    saved.set("open", open ? "1" : null);
    // A hidden box has no height to measure, so a draft put back while the
    // drawer was closed is sized once it shows.
    if (open) autosize();
  }

  function setPages(on) {
    pages.checked = on;
    drawer.toggleAttribute("data-pages", on);
    input.placeholder = on ? "What should the pages cover?" : "Ask anything, or ask for a page…";
    saved.set("pages", on ? "1" : null);
  }

  function setBusy(on) {
    busy = on;
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
    if (on) return;
    setActivity("");
    // CHANGES_SCRIPT holds its reload while a turn runs.
    document.dispatchEvent(new Event("kb25:chat-idle"));
  }

  function setActivity(text) {
    activity.textContent = text;
    activity.hidden = !text;
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function showEmpty() {
    const empty = el("div", "chat-empty");
    empty.append(
      el("span", "chat-empty-mark"),
      el("p", "", "Ask about anything, or ask for a page. Switch on Write to KB to have the answer written as pages instead.")
    );
    log.replaceChildren(empty);
  }

  function showError(text) {
    log.querySelector(".chat-empty")?.remove();
    log.append(el("div", "chat-msg chat-error", text));
    scrollDown();
  }

  const ready = () => engines.filter((engine) => engine.status.state === "ok");
  const engineName = (id) => (engines.find((engine) => engine.id === id) || { name: id }).name;

  // A new chat's engine: the one picked last time while it is ready, else the first ready.
  function chosenEngine() {
    const list = ready();
    const last = saved.get("engine");
    return (list.find((engine) => engine.id === last) || list[0] || {}).id;
  }

  // The switch shows only for a new chat with two engines ready; a thread
  // keeps the engine it began with, which its label names instead.
  function renderEngines() {
    const list = ready();
    const both = list.length > 1;
    engineLabel.hidden = !(both && threadEngine);
    engineLabel.textContent = threadEngine ? engineName(threadEngine) : "";
    enginePicker.hidden = !(both && !threadEngine);
    if (!enginePicker.hidden) {
      const current = chosenEngine();
      enginePicker.replaceChildren(
        ...list.map((engine) => {
          const button = el("button", "", engine.name.split(" ")[0]);
          button.type = "button";
          button.setAttribute("role", "radio");
          button.setAttribute("aria-checked", String(engine.id === current));
          button.title = "Run this chat on " + engine.name;
          button.addEventListener("click", () => {
            saved.set("engine", engine.id);
            renderEngines();
          });
          return button;
        })
      );
    }
    renderRun();
  }

  const EFFORTS = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };

  // The model and effort the next message runs with, from what its engine
  // listed: each engine's last pick, else what it starts on (start). An
  // effort the model does not take gives way to the start's, then high, then
  // the model's lowest; a model that takes none shows no effort at all.
  function renderRun() {
    const engine = engines.find((e) => e.id === (threadEngine || chosenEngine())) || {};
    const models = engine.models;
    const option = (value, text) => {
      const node = el("option", "", text);
      node.value = value;
      return node;
    };
    if (models) {
      const model =
        models.find((m) => m.id === saved.get("model." + engine.id)) ||
        models.find((m) => m.id === engine.start.model) ||
        models[0];
      modelPicker.replaceChildren(...models.map((m) => option(m.id, m.name)));
      modelPicker.value = model.id;
      const efforts = model.efforts;
      effortPicker.replaceChildren(...efforts.map((e) => option(e, (EFFORTS[e] || e) + " effort")));
      const wanted = [saved.get("effort." + engine.id), engine.start.effort, "high"];
      effortPicker.value = wanted.find((e) => efforts.includes(e)) || efforts[0] || "";
      modelPicker.hidden = false;
      effortPicker.hidden = !efforts.length;
    } else {
      modelPicker.replaceChildren();
      effortPicker.replaceChildren();
      modelPicker.hidden = effortPicker.hidden = true;
    }
    // The row under the box also carries the engine switch, so it shows while either does.
    runRow.hidden = !models && enginePicker.hidden;
  }

  const HELP = {
    claude: { url: "https://claude.com/claude-code", login: "claude", update: "claude update" },
    codex: { url: "https://github.com/openai/codex", login: "codex login", update: "codex update" },
  };

  // What one engine still needs before it can run.
  function engineHelp(engine) {
    const help = HELP[engine.id] || {};
    const status = engine.status;
    const code = (text) => el("code", "", text);
    const name = el("strong", "", engine.name);
    if (status.state === "missing") {
      const link = el("a", "", (help.url || "").replace("https://", ""));
      link.href = help.url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      return [name, " isn't installed. Install it from ", link, " and sign in."];
    }
    if (status.state === "signed-out") {
      return [name, " is installed but not signed in. Run ", code(help.login), " in a terminal and sign in."];
    }
    if (status.state === "too-old") {
      return [name, " " + status.version + " is too old for the chat, which needs " + status.minimum + " or newer. Run ", code(help.update), " in a terminal."];
    }
    if (status.state === "broken") {
      return [name, " at " + (status.path || "?") + " didn't answer as expected" + (status.detail ? ": " + status.detail : ".")];
    }
    return [name, " is ready."];
  }

  // Neither engine is ready: say what each needs.
  function showSetup() {
    const p = (...nodes) => { const para = el("p"); para.append(...nodes); return para; };
    const parts = [p("The chat runs on Claude Code or Codex, and neither is ready on this computer.")];
    for (const engine of engines) parts.push(p(...engineHelp(engine)));
    parts.push(p("Then press Retry."));
    const retry = el("button", "button secondary", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => start(true));
    parts.push(retry);
    setup.replaceChildren(...parts);
    setup.hidden = false;
    form.hidden = true;
    log.hidden = true;
  }

  const VERBS = {
    created: "Created", updated: "Updated", moved: "Moved", renamed: "Renamed",
    archived: "Archived", restored: "Restored", deleted: "Deleted", noted: "Left a note on",
    added: "Added",
  };

  // The server's account of what a turn wrote, every page linked, and an added image to its gallery.
  function reportCard(changes) {
    const card = el("div", "chat-msg chat-report");
    card.append(el("div", "chat-report-head", "Done"));
    const list = el("ul", "chat-report-list");
    for (const change of changes) {
      const item = el("li");
      // What changed picks the row's icon: a page, a folder, a space or an image.
      item.dataset.what = change.what;
      const verb = VERBS[change.kind] || change.kind;
      item.append(el("span", "chat-report-verb", change.what === "page" ? verb + " " : verb + " " + change.what + " "));
      if (change.href) {
        const link = el("a", "", change.title);
        link.href = change.href;
        item.append(link);
      } else {
        item.append(el("span", "chat-report-gone", change.title));
      }
      item.append(el("span", "chat-report-slug", change.slug));
      list.append(item);
    }
    card.append(list);
    return card;
  }

  function renderMessage(message) {
    log.querySelector(".chat-empty")?.remove();
    if (message.role === "user") {
      const bubble = el("div", "chat-msg chat-user");
      if (message.forcePages) bubble.append(el("span", "chat-tag", "Write to KB"));
      if (message.images && message.images.length) {
        const row = el("div", "chat-user-images");
        for (const image of message.images) {
          const link = el("a");
          link.href = image.href;
          link.target = "_blank";
          link.rel = "noopener";
          link.title = image.name;
          const img = el("img");
          img.src = image.href;
          img.alt = image.name;
          link.append(img);
          row.append(link);
        }
        bubble.append(row);
      }
      if (message.text) bubble.append(el("div", "chat-user-text", message.text));
      log.append(bubble);
    } else if (message.role === "assistant") {
      const reply = el("div", "chat-msg chat-assistant prose");
      reply.append(...new DOMParser().parseFromString(message.html, "text/html").body.childNodes);
      log.append(reply);
    } else if (message.role === "report") {
      log.append(reportCard(message.changes));
    } else if (message.role === "error") {
      log.append(el("div", "chat-msg chat-error", message.text));
    }
  }

  function closeSource() {
    if (source) source.close();
    source = null;
    streaming = null;
  }

  // Follow the running turn. Its stream replays the turn from its question,
  // so whoever attaches mid-turn sees all of it.
  function attach() {
    closeSource();
    setBusy(true);
    setActivity("Thinking…");
    const es = new EventSource("/_chat/threads/" + threadId + "/events");
    source = es;
    let seen = false;
    let dropped = false;
    es.onerror = () => { dropped = true; };
    es.onmessage = (e) => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      const stick = nearBottom();
      if (event.type === "done") {
        es.close();
        if (source === es) source = null;
        streaming = null;
        setBusy(false);
        // Nothing seen, or the stream broke on the way (a restart): the
        // thread as stored is the only account of the turn.
        if (!seen || dropped) loadThread();
        return;
      }
      seen = true;
      if (event.type === "user") {
        renderMessage(event.message);
      } else if (event.type === "text") {
        if (!streaming) {
          streaming = el("div", "chat-msg chat-assistant chat-streaming");
          log.append(streaming);
        }
        streaming.textContent += event.text;
      } else if (event.type === "activity") {
        setActivity(event.text);
      } else if (event.type === "message") {
        if (event.message.role === "assistant" && streaming) {
          streaming.remove();
          streaming = null;
        }
        renderMessage(event.message);
      }
      if (stick) scrollDown();
    };
  }

  async function loadThread() {
    closeSource();
    history.hidden = true;
    const thread = threadId ? await getJson("/_chat/threads/" + threadId) : null;
    if (!thread) {
      threadId = null;
      threadEngine = null;
      saved.set("thread", null);
      titleEl.textContent = "New chat";
      renderEngines();
      showEmpty();
      setBusy(false);
      return;
    }
    titleEl.textContent = thread.title;
    threadEngine = thread.engine;
    renderEngines();
    log.replaceChildren();
    // A running turn's question is also the first thing its stream replays.
    (thread.running ? thread.messages.slice(0, -1) : thread.messages).forEach(renderMessage);
    if (!log.childElementCount) showEmpty();
    if (thread.running) attach();
    else setBusy(false);
    scrollDown();
  }

  async function start(fresh) {
    const status = await getJson("/_chat/status" + (fresh ? "?fresh=1" : ""));
    if (!status) {
      log.hidden = false;
      return showError("Crescent didn't answer. Is it still running?");
    }
    engines = status.engines || [];
    if (!ready().length) return showSetup();
    setup.hidden = true;
    form.hidden = false;
    log.hidden = false;
    renderEngines();
    if (!loaded) {
      loaded = true;
      await loadThread();
    }
  }

  const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml"];
  const IMAGE_EXTENSIONS = fileInput.accept.split(",");
  const isImage = (file) =>
    IMAGE_TYPES.includes(file.type) || IMAGE_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

  // The copy the model is shown: no more than 1568 pixels on its longer side,
  // which is as much as Claude looks at, drawn on white as a JPEG. Null when
  // the browser cannot draw the image, or will not let it be read back, as
  // some will not for an SVG; the agent then has only its path.
  async function modelCopy(url) {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const width = img.naturalWidth || 1024;
      const height = img.naturalHeight || 1024;
      const scale = Math.min(1, 1568 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const draw = canvas.getContext("2d");
      draw.fillStyle = "#fff";
      draw.fillRect(0, 0, canvas.width, canvas.height);
      draw.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    } catch {
      return null;
    }
  }

  function renderAttachments() {
    strip.replaceChildren(
      ...attachments.map((item) => {
        const chip = el("div", "chat-attachment");
        chip.title = item.file.name;
        const img = el("img");
        img.src = item.url;
        img.alt = item.file.name;
        const remove = el("button", "chat-attachment-remove", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove " + item.file.name);
        remove.addEventListener("click", () => {
          dropAttachments([item]);
          input.focus();
        });
        chip.append(img, remove);
        return chip;
      })
    );
    strip.hidden = !attachments.length;
  }

  function dropAttachments(items) {
    for (const item of items) URL.revokeObjectURL(item.url);
    attachments = attachments.filter((item) => !items.includes(item));
    renderAttachments();
    draftImages.set(attachments.map((item) => item.file));
  }

  // Put back the images a draft had on the last page, ahead of any attached
  // since this one loaded.
  async function restoreImages() {
    const stored = await draftImages.get();
    if (!Array.isArray(stored) || !stored.length) return;
    const restored = [];
    for (const item of stored) {
      if (!item || !(item.blob instanceof Blob)) continue;
      const file = new File([item.blob], item.name || "image", { type: item.type || item.blob.type });
      const url = URL.createObjectURL(file);
      restored.push({ file, url, copy: modelCopy(url) });
    }
    const since = attachments;
    attachments = restored.concat(since);
    renderAttachments();
    if (since.length) draftImages.set(attachments.map((item) => item.file));
  }

  // Take what was picked or dropped: images, up to the limit, and say what was left out.
  function attachFiles(files) {
    const list = Array.from(files || []);
    const images = list.filter(isImage);
    const others = list.filter((file) => !isImage(file));
    const room = Math.max(0, MAX_IMAGES - attachments.length);
    for (const file of images.slice(0, room)) {
      const url = URL.createObjectURL(file);
      attachments.push({ file, url, copy: modelCopy(url) });
    }
    renderAttachments();
    draftImages.set(attachments.map((item) => item.file));
    if (others.length) {
      const names = others.map((file) => file.name).join(", ");
      showError("Only images can be attached; " + names + (others.length === 1 ? " is not one." : " are not."));
    }
    if (images.length > room) showError("A message can take " + MAX_IMAGES + " images at most.");
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if ((!text && !attachments.length) || busy) return;
    if (!threadId) {
      threadId = newId();
      saved.set("thread", threadId);
    }
    const engine = threadEngine || chosenEngine();
    const sending = attachments.slice();
    setBusy(true);
    setActivity(sending.length ? "Sending the images…" : "Thinking…");
    // A new chat says which engine to run on; a thread keeps its own.
    // Model and effort go with every message, unless left to the engine.
    const data = new FormData();
    data.append("text", text);
    if (pages.checked) data.append("forcePages", "true");
    data.append("slug", slug);
    if (!threadEngine && engine) data.append("engine", engine);
    if (modelPicker.value) data.append("model", modelPicker.value);
    if (effortPicker.value) data.append("effort", effortPicker.value);
    const copies = await Promise.all(sending.map((item) => item.copy));
    sending.forEach((item, n) => {
      data.append("image", item.file, item.file.name);
      if (copies[n]) data.append("view-" + n, copies[n], "view.jpg");
    });
    let res = null;
    try {
      res = await fetch("/_chat/threads/" + threadId + "/messages", { method: "POST", body: data });
    } catch {}
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setBusy(false);
      if (res && res.status === 503 && body.engine) {
        const problem = el("div", "chat-msg chat-error");
        problem.append(...engineHelp(body.engine), " Then send again.");
        log.querySelector(".chat-empty")?.remove();
        log.append(problem);
        return scrollDown();
      }
      return showError(res ? body.error || "That message couldn't be sent." : "Crescent didn't answer. Is it still running?");
    }
    // Sent, so no longer a draft; until here a failed send leaves it all in place.
    input.value = "";
    saved.set("draft", null);
    autosize();
    dropAttachments(sending);
    if (body.title) titleEl.textContent = body.title;
    threadEngine = threadEngine || engine;
    renderEngines();
    attach();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    autosize();
    saved.set("draft", input.value || null);
  });
  pages.addEventListener("change", () => setPages(pages.checked));
  attachButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    attachFiles(fileInput.files);
    fileInput.value = "";
    input.focus();
  });

  // Files dragged over the drawer are taken for attaching, with a sign saying
  // so; dropped anywhere else they are the browser's, as before. Entering a
  // child counts before leaving its parent, hence the depth.
  const carriesFiles = (event) =>
    !form.hidden && !!event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
  let dragDepth = 0;
  drawer.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.hidden = false;
  });
  drawer.addEventListener("dragover", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  drawer.addEventListener("dragleave", (event) => {
    if (!carriesFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.hidden = true;
  });
  drawer.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropZone.hidden = true;
    attachFiles(event.dataTransfer.files);
    input.focus();
  });
  modelPicker.addEventListener("change", () => {
    saved.set("model." + (threadEngine || chosenEngine()), modelPicker.value || null);
    renderRun();
  });
  effortPicker.addEventListener("change", () => {
    saved.set("effort." + (threadEngine || chosenEngine()), effortPicker.value || null);
  });

  stopBtn.addEventListener("click", () => {
    if (threadId) fetch("/_chat/threads/" + threadId + "/stop", { method: "POST" }).catch(() => {});
  });

  $("[data-chat-new]").addEventListener("click", () => {
    threadId = null;
    saved.set("thread", null);
    loadThread();
    input.focus();
  });

  async function showHistory() {
    const data = await getJson("/_chat/threads");
    const threads = data ? data.threads : [];
    const rows = threads.map((thread) => {
      const row = el("div", "chat-history-row");
      if (thread.id === threadId) row.classList.add("is-current");
      const open = el("button", "chat-history-open");
      open.type = "button";
      open.append(el("span", "chat-history-title", thread.title));
      const when = new Date(thread.updatedAt);
      const tags = (ready().length > 1 ? engineName(thread.engine) + " · " : "") + (thread.running ? "Answering · " : "");
      open.append(el("span", "chat-history-when", tags + when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })));
      open.addEventListener("click", () => {
        threadId = thread.id;
        saved.set("thread", threadId);
        loadThread();
      });
      row.append(open);
      if (!thread.running) {
        const del = el("button", "chat-icon-button", "×");
        del.type = "button";
        del.setAttribute("aria-label", "Delete " + thread.title);
        del.title = "Delete this chat";
        del.addEventListener("click", async () => {
          await fetch("/_chat/threads/" + thread.id + "/delete", { method: "POST" }).catch(() => {});
          if (thread.id === threadId) {
            threadId = null;
            saved.set("thread", null);
            await loadThread();
          }
          showHistory();
        });
        row.append(del);
      }
      return row;
    });
    history.replaceChildren(...(rows.length ? rows : [el("p", "chat-empty", "No earlier chats.")]));
    history.hidden = false;
  }

  $("[data-chat-history-open]").addEventListener("click", () => {
    if (history.hidden) showHistory();
    else history.hidden = true;
  });

  $("[data-chat-close]").addEventListener("click", () => {
    setOpen(false);
    toggle.focus();
  });

  drawer.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!history.hidden) history.hidden = true;
    else {
      setOpen(false);
      toggle.focus();
    }
  });

  toggle.addEventListener("click", () => {
    const open = drawer.hidden;
    setOpen(open);
    if (!open) return;
    start(true);
    input.focus();
  });

  setPages(saved.get("pages") === "1");
  input.value = saved.get("draft") || "";
  restoreImages();
  // Before first paint, so a drawer that was open on the last page is simply there.
  if (saved.get("open") === "1") {
    setOpen(true);
    start(false);
  }
})();
`;
