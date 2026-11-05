/**
 * The viewer's server: reads the configuration, builds what the routes share,
 * registers the routes, and listens. The routes live under server/, one module
 * per feature, so a new route belongs in one of those rather than here.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Content, flatten } from "./content.js";
import { ChangeFeed } from "./changes.js";
import { makeGit } from "./git.js";
import { makeKbWrites } from "./kb-writes.js";
import { makeSeenPages } from "./seen.js";
import { isLoopbackHost } from "./loopback.js";
import { envFlag, envNumber, syncFromEnv } from "./sync.js";
import { DEFAULT_FEEDBACK_RELAY, checkoutVersion, makeFeedback } from "./feedback.js";
import { claudeEngine } from "./claude-cli.js";
import { codexEngine } from "./codex-cli.js";
import { makeChat } from "./chat.js";
import { makeChatStore } from "./chat-store.js";
import { DEFAULT_RELEASES_URL, findInstall, makeUpdater } from "./update.js";
import { configureViews } from "./views.js";
import { registerArchiveRoutes } from "./server/archive.js";
import { registerAuth } from "./server/auth.js";
import { registerChangeRoutes } from "./server/changes.js";
import { registerChatRoutes } from "./server/chat.js";
import type { ServerContext, Site } from "./server/context.js";
import { registerDashboardRoutes } from "./server/dashboards.js";
import { registerDesktopRoutes } from "./server/desktop.js";
import { registerFeedbackRoutes } from "./server/feedback.js";
import { registerGalleryRoutes } from "./server/gallery.js";
import { registerFormParser } from "./server/http.js";
import { registerLabelRoutes } from "./server/labels.js";
import { forwardMovedPort } from "./server/moved-port.js";
import { registerMoveRoutes } from "./server/move.js";
import { registerNoteRoutes } from "./server/notes.js";
import { registerPageRoutes } from "./server/pages.js";
import { makeRender } from "./server/render.js";
import { registerSearchRoutes } from "./server/search.js";
import { registerSpaceRoutes } from "./server/spaces.js";
import { registerStaticRoutes } from "./server/static.js";
import { registerUpdateRoutes } from "./server/update.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- config ---------------------------------------------------------------
loadEnvFile(path.join(__dirname, "..", "..", ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const KB_DIR = path.resolve(
  process.env.KB_DIR ?? path.join(__dirname, "..", "..", "kb")
);
// Loopback-only by default, so the viewer is reachable from this machine and
// nowhere else. Fastify binds both 127.0.0.1 and ::1 for "localhost". Leave it
// there: a wider bind publishes a sign-in form backed by one static credential
// pair, in cleartext unless something in front of it terminates TLS.
const HOST = process.env.HOST ?? "localhost";
const PORT = Number(process.env.PORT ?? 4000);
const SITE_TITLE = process.env.SITE_TITLE ?? "Knowledge Base";

// Sign-in off, for a personal install only this machine can reach (the
// one-line installer sets it). Refused on a wider bind, where it would publish
// the whole KB, editable, to the network. Off, AUTH_USERNAME is "", which the
// views read as "no account": no username, no Log out.
const AUTH_DISABLED = envFlag("AUTH_DISABLED");
if (AUTH_DISABLED && !isLoopbackHost(HOST)) {
  console.error(`AUTH_DISABLED needs a loopback HOST such as localhost, not "${HOST}".`);
  process.exit(1);
}
const AUTH_USERNAME = AUTH_DISABLED ? "" : requireEnv("AUTH_USERNAME");
const AUTH_PASSWORD = AUTH_DISABLED ? "" : requireEnv("AUTH_PASSWORD");
const AUTH_SESSION_SECRET = AUTH_DISABLED
  ? crypto.randomBytes(32).toString("base64url")
  : requireEnv("AUTH_SESSION_SECRET");
// A server a launcher started (KB25.app, the Start-menu shortcut) has no
// terminal to stop it. KB25's window stops it when it closes (POST /_quit),
// and a page in an ordinary browser tab gets a Quit button. Loopback only: on
// a wider bind it would let any visitor stop the server.
const DESKTOP = envFlag("KB25_DESKTOP") && isLoopbackHost(HOST);
// Writes to the KB that open pages should show: an agent's through MCP, a
// pull's, another editor's. Each page is rendered with the feed's cursor and
// follows it from there on GET /_changes.
const changes = new ChangeFeed(KB_DIR);
changes.start();
configureViews({ desktop: DESKTOP, changeCursor: () => changes.cursor });

const content = new Content(KB_DIR);
// The pages opened in this viewer, and every page that was already there when
// the list began; the sidebar dots the rest as new.
const seen = makeSeenPages(KB_DIR, async () =>
  flatten(await content.tree("all")).flatMap((n) => (n.id ? [n.id] : []))
);
// Multi-machine sync, off unless KB_SYNC is set. Every auto-commit re-arms a
// debounced push; failures never reach the request that triggered them.
const sync = syncFromEnv(KB_DIR);
const kbGit = makeGit(KB_DIR, sync ? (repoRoot) => sync.notifyCommit(repoRoot) : undefined);
// Every write this server makes ends in one of these commits, with the paths it
// wrote. The page that made the write already shows it, so the change feed
// leaves those paths out rather than reload that page over what it has open.
const git: typeof kbGit = {
  ...kbGit,
  commitFiles: (fsPaths, message) => {
    changes.ownWrite(fsPaths);
    return kbGit.commitFiles(fsPaths, message);
  },
  commitMovedPaths: (fsPaths, message) => {
    changes.ownWrite(fsPaths);
    return kbGit.commitMovedPaths(fsPaths, message);
  },
};
// Every write the viewer makes goes through here, which commits it.
const writes = makeKbWrites({ content, git, via: "web" });
// TRUST_PROXY only when the viewer really does sit behind one: it makes Fastify
// believe `x-forwarded-*`, which is what lets `req.protocol` and `req.ip` report
// the client rather than the proxy. Believing those headers unproxied would let
// any caller spoof both, and `req.ip` keys the sign-in lockout.
const app = Fastify({
  logger: false,
  bodyLimit: 5 * 1024 * 1024,
  trustProxy: envFlag("TRUST_PROXY"),
});

// In-app updates, for an installed copy only: a checkout has no VERSION or
// private Node, so neither route exists there and the page's update card,
// finding no /_update, stays hidden. KB25_UPDATE_CHECK=0 turns the check off.
const install = findInstall(__dirname);
const updateCheck = !/^(0|false|no|off)$/i.test(process.env.KB25_UPDATE_CHECK?.trim() ?? "");
const updater =
  install && updateCheck
    ? makeUpdater({ install, releasesUrl: process.env.KB25_RELEASES_URL || DEFAULT_RELEASES_URL })
    : null;

// Feedback to the developer (feedback.ts), sent through the relay or queued
// while the relay is out of reach. KB25_FEEDBACK_RELAY points it elsewhere,
// e.g. at `wrangler dev`.
const feedback = makeFeedback({
  relay: process.env.KB25_FEEDBACK_RELAY || DEFAULT_FEEDBACK_RELAY,
  outboxDir: install
    ? path.join(install.home, "feedback-outbox")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "kb25", "feedback-outbox"),
  version: install?.version ?? checkoutVersion(__dirname),
  install: install ? "installed" : "checkout",
  logFiles: install ? [path.join(install.home, "kb25.log"), install.logFile] : [],
});
feedback.startRetrying();

// The chat drawer: the person's own Claude Code or Codex, run one turn at a
// time with the kb25 MCP server attached (chat.ts). The MCP server is this
// install's bundle when there is one, else the checkout's source through tsx.
const BUNDLED_MCP = path.join(__dirname, "mcp.mjs");
const chat = makeChat({
  store: makeChatStore(KB_DIR),
  engines: [claudeEngine, codexEngine],
  mcp: {
    command: process.execPath,
    args: fs.existsSync(BUNDLED_MCP)
      ? [BUNDLED_MCP]
      : ["--import", import.meta.resolve("tsx"), path.join(__dirname, "mcp.ts")],
    env: { KB_DIR, KB25_COMMIT_VIA: "chat" },
  },
  // One per KB, so a checkout's server and an installed one never share it.
  workDir: path.join(os.tmpdir(), `kb25-chat-${crypto.createHash("sha256").update(KB_DIR).digest("hex").slice(0, 12)}`),
  pages: async () => flatten(await content.tree("all")),
});

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const source = fs.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

// --- routes ---------------------------------------------------------------
// One module per feature under server/. A hook reaches every route of this
// instance, whenever it was added, but a scoped plugin (the gallery's and
// feedback's uploads) keeps only the hooks added before it: sign-in goes first.
const site: Site = { siteTitle: SITE_TITLE, username: AUTH_USERNAME, content, git, writes, seen };
const ctx: ServerContext = { ...site, render: makeRender(site) };

registerFormParser(app);
registerAuth(app, {
  siteTitle: SITE_TITLE,
  disabled: AUTH_DISABLED,
  username: AUTH_USERNAME,
  password: AUTH_PASSWORD,
  sessionSecret: AUTH_SESSION_SECRET,
  desktop: DESKTOP,
});
await registerStaticRoutes(app, { kbDir: KB_DIR, content, appDir: path.join(__dirname, "..") });
registerSpaceRoutes(app, ctx);
registerPageRoutes(app, ctx);
registerArchiveRoutes(app, ctx);
registerMoveRoutes(app, ctx);
registerNoteRoutes(app, ctx);
registerLabelRoutes(app, ctx);
registerSearchRoutes(app, ctx);
registerDashboardRoutes(app, ctx);
await registerGalleryRoutes(app, ctx);
registerUpdateRoutes(app, { siteTitle: SITE_TITLE, updater });
await registerFeedbackRoutes(app, feedback);
registerChatRoutes(app, ctx, chat);
const changeStreams = registerChangeRoutes(app, changes);
const windows = registerDesktopRoutes(app, { desktop: DESKTOP, chat, shutdown });

let shuttingDown = false;
/**
 * Stop serving and exit. `closeWindow` tells KB25's window to close as well
 * (the Quit button); a signal (logout, or an update stopping this server to
 * restart it) leaves the window open for the server that comes next.
 */
async function shutdown(reason: string, closeWindow = false): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`KB viewer stopping: ${reason}`);
  windows.endAll(closeWindow);
  changes.close();
  changeStreams.endAll();
  // End chat turns cleanly, so their threads are saved and can be resumed.
  await Promise.race([chat.stopAll(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  // Let a save already under way finish, but never wait on it for long.
  await Promise.race([app.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (sync) {
    // Give the debounced push for the last edit a chance to land before exit.
    await sync.flush().catch(() => {});
    sync.stop();
  }
  // Only this server's own pid, which a newer server may already have replaced.
  if (install) {
    try {
      if (fs.readFileSync(install.pidFile, "utf8").trim() === String(process.pid)) {
        fs.rmSync(install.pidFile, { force: true });
      }
    } catch {}
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

if (sync) {
  // Pick up whatever the other machine pushed before serving a single stale page.
  await sync.pullAll();
  sync.startPeriodicPull(envNumber("KB_SYNC_INTERVAL_MS", 0));
}

try {
  await app.listen({ host: HOST, port: PORT });
  // An installed copy records its own pid, and only once it holds the port.
  // When two launches race (a double-click, or an update restarting KB25 as
  // it is opened), the losing server never gets here, so updates and removal
  // always stop the server that is actually answering.
  if (install) fs.writeFileSync(install.pidFile, String(process.pid));
  console.log(`KB viewer running at http://${HOST}:${PORT}  (content: ${KB_DIR})`);
} catch (err) {
  console.error(err);
  process.exit(1);
}

// An update that moved KB25 off a dev-server port answers on the old one for a
// few minutes (server/moved-port.ts).
const MOVED_FROM = envNumber("KB25_MOVED_FROM", 0);
if (install && MOVED_FROM && MOVED_FROM !== PORT) {
  await forwardMovedPort({ host: HOST, port: PORT, from: MOVED_FROM, updater });
}
