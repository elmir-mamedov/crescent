import { renderHead } from "./head.js";
import { escapeHtml } from "./html.js";

/**
 * The update gate: where an installed copy opens while a newer release is out,
 * which installs it before the app opens (update.ts).
 */

export interface UpdateGateView {
  siteTitle: string;
  current: string;
  latest: string;
  notesUrl: string;
  logFile: string;
  /** The server's id (update.ts), which a restart on the old version changes. */
  instance: string;
  /** An update is already running, such as one the page's card started. */
  updating: boolean;
}

/**
 * The update gate (feedback issue #21): what KB25's window opens on, in place
 * of the app, while a newer release is out. Installing it is the only way on;
 * an update that fails lets the person in on this version, until KB25 is
 * opened again. GATE_SCRIPT runs the update and follows it.
 */
export function updateGateLayout(v: UpdateGateView): string {
  const latest = escapeHtml(v.latest);
  return `<!doctype html>
<html lang="en">
${renderHead(`Update · ${escapeHtml(v.siteTitle)}`)}
<body class="gate-page">
<main class="gate-panel" data-gate data-current="${escapeHtml(v.current)}" data-latest="${latest}" data-log="${escapeHtml(v.logFile)}" data-instance="${escapeHtml(v.instance)}"${v.updating ? " data-updating" : ""}>
  <img class="gate-icon" src="/kb25.svg" alt="" width="48" height="48" />
  <h1 data-gate-title>Update Crescent to ${latest}</h1>
  <p class="gate-text" data-gate-text>A new version is out. Crescent installs every update before it opens, as updates can carry security fixes. It takes a minute or so, and your pages and settings are kept.</p>
  <a class="gate-notes" href="${escapeHtml(v.notesUrl)}" target="_blank" rel="noopener">What's new in ${latest}</a>
  <div class="gate-progress" data-gate-progress hidden></div>
  <div class="gate-actions" data-gate-actions>
    <button type="button" class="button primary" data-gate-install>Install update</button>
  </div>
</main>
<script>${GATE_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Runs the update gate's update (updateGateLayout) and opens the app once the
 * server is back on the new version. Shares the update card's storage keys, so
 * the first page says the update is done, and a person let in after a failed
 * update isn't offered the same one again straight away.
 */
const GATE_SCRIPT = `
(() => {
  const gate = document.querySelector("[data-gate]");
  if (!gate || !window.fetch) return;
  const { current, latest, log } = gate.dataset;
  const title = gate.querySelector("[data-gate-title]");
  const text = gate.querySelector("[data-gate-text]");
  const progress = gate.querySelector("[data-gate-progress]");
  const actions = gate.querySelector("[data-gate-actions]");
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  // Replace, so Back never comes here again.
  const enter = () => location.replace("/");
  const button = (label, variant, onClick) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "button " + variant;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  };
  function show(heading, body, busy, ...buttons) {
    title.textContent = heading;
    text.textContent = body;
    progress.hidden = !busy;
    actions.replaceChildren(...buttons);
    actions.hidden = !buttons.length;
  }
  const busy = () =>
    show("Updating Crescent to " + latest + "…", "Crescent opens by itself when it's done. Your pages and settings are kept.", true);

  async function getStatus() {
    const res = await fetch("/_update", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    return res.json();
  }

  function failed(reason) {
    show(
      "The update didn't install",
      (reason ? reason + " " : "") +
        "Check the internet connection and try again; details are in " + log + ". " +
        "Until then, Crescent " + current + " still works, and it asks again the next time it opens.",
      false,
      button("Try again", "secondary", install),
      button("Continue with " + current, "primary", () => {
        store("kb25.update.dismissed", latest);
        enter();
      })
    );
  }

  // Done once a server answers on another version. This server saying the
  // installer failed, or a new one still on this version (which a failed
  // installer starts again), means it didn't happen.
  function follow(instance) {
    busy();
    const deadline = Date.now() + 5 * 60 * 1000;
    const poll = async () => {
      let now = null;
      try { now = await getStatus(); } catch {} // the server is restarting
      if (now && now.current !== current) {
        store("kb25.update.done", now.current);
        enter();
      } else if ((now && (now.state === "failed" || now.instance !== instance)) || Date.now() > deadline) {
        failed();
      } else {
        setTimeout(poll, 1500);
      }
    };
    setTimeout(poll, 1500);
  }

  async function install() {
    busy();
    let res = null;
    try { res = await fetch("/_update", { method: "POST" }); } catch {}
    if (res && res.status === 202) {
      const started = await res.json().catch(() => null);
      return follow(started ? started.instance : gate.dataset.instance);
    }
    // Refused: an update already running is followed, and with nothing left
    // to install, the app opens.
    let now = null;
    try { now = await getStatus(); } catch {}
    if (now && now.state === "updating") return follow(now.instance);
    if (now && !now.available) return enter();
    const body = res ? await res.json().catch(() => ({})) : {};
    failed(body.error);
  }

  gate.querySelector("[data-gate-install]").addEventListener("click", install);
  if ("updating" in gate.dataset) follow(gate.dataset.instance);
})();
`;
