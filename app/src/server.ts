import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  Content,
  downloadFilename,
  isFolderPage,
  type ArchiveMutation,
  type BatchMoveMutation,
  type CreatePageMutation,
  type DeleteMutation,
  type MoveMutation,
  type PageNode,
  type ReorderMutation,
  type SpaceInfo,
  type TreeFilter,
} from "./content.js";
import { makeGit } from "./git.js";
import { makeLoginThrottle, retryAfterWords } from "./login-throttle.js";
import { crossSiteRefusal, isLoopbackHost } from "./loopback.js";
import { envFlag, envNumber, syncFromEnv } from "./sync.js";
import { parseWordDiff } from "./diff.js";
import { DEFAULT_FEEDBACK_RELAY, FEEDBACK_BODY_LIMIT, checkoutVersion, makeFeedback } from "./feedback.js";
import { createRenderer, noteSegments, sourceBlocks, type Section } from "./markdown.js";
import { makePresence } from "./presence.js";
import { collectNotes, groupNotesByPage, summarizeNotes } from "./note-index.js";
import {
  insertNote,
  isAgentNote,
  newNoteId,
  normalizeQuote,
  noteStamp,
  parseNotes,
  removeNote,
  splitFrontmatter,
  updateNote,
  type NoteKind,
} from "./notes.js";
import { mapWithConcurrency, searchPages, searchTokens, type SearchHit } from "./search.js";
import { DEFAULT_RELEASES_URL, findInstall, makeUpdater } from "./update.js";
import { cleanLabelNames, labelKey } from "./frontmatter.js";
import {
  applyPageLabels,
  filterLabelled,
  knownLabels,
  loadLabelSet,
  spaceNodes,
  type LabelDef,
} from "./labels.js";
import {
  CHAR_CAP,
  ensureSpaceInstructions,
  instructionsSlug,
  isInstructionsSlug,
} from "./space-instructions.js";
import {
  archiveLayout,
  configureViews,
  dashboardLayout,
  dashboardsLayout,
  deleteLayout,
  diffLayout,
  editLayout,
  escapeHtml,
  folderLayout,
  labelsDashboardLayout,
  labelsHref,
  layout,
  loginLayout,
  notFound,
  spacesLayout,
  type LabelResult,
  type ViewNotice,
} from "./views.js";

const execFileAsync = promisify(execFile);
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

// Sidebar search. A single character matches nearly every page, so the client is
// told not to ask and the server refuses anyway; the cap bounds the payload the
// dropdown can be handed.
const SEARCH_MIN_QUERY = 2;
const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;
// The Labels view. A filter of more labels than this matches nothing useful
// and only makes the URL a lever for work; a search there lists more than the
// type-ahead because it is the page a person reads results on.
const LABEL_FILTER_MAX = 10;
const LABELS_SEARCH_LIMIT = 50;

// Site icons bundled with the app, served from the site root so the
// <link rel="icon"> tags and the browser's automatic /favicon.ico lookup
// resolve. Each is registered as a literal route, which find-my-way ranks
// above the `/*` page catch-all.
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PUBLIC_FILES = [
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "favicon-64x64.png",
  "favicon-96x96.png",
  "favicon-192x192.png",
  "favicon-512x512.png",
  "apple-touch-icon.png",
  "kb25.svg",
];
const PUBLIC_PATHS = new Set(PUBLIC_FILES.map((file) => `/${file}`));
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
// terminal to stop it, so the page gets a Quit button and the server quits by
// itself a while after its last tab closes (presence.ts). Loopback only: on a
// wider bind it would let any visitor stop the server.
const DESKTOP = envFlag("KB25_DESKTOP") && isLoopbackHost(HOST);
const QUIT_GRACE_MS = 30_000;
configureViews({ desktop: DESKTOP });
const SESSION_COOKIE = "kb_session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const content = new Content(KB_DIR);
// Multi-machine sync, off unless KB_SYNC is set. Every auto-commit re-arms a
// debounced push; failures never reach the request that triggered them.
const sync = syncFromEnv(KB_DIR);
const git = makeGit(KB_DIR, sync ? (repoRoot) => sync.notifyCommit(repoRoot) : undefined);
// TRUST_PROXY only when the viewer really does sit behind one: it makes Fastify
// believe `x-forwarded-*`, which is what lets `req.protocol` and `req.ip` report
// the client rather than the proxy. Believing those headers unproxied would let
// any caller spoof both, and `req.ip` keys the sign-in lockout.
const app = Fastify({
  logger: false,
  bodyLimit: 5 * 1024 * 1024,
  trustProxy: envFlag("TRUST_PROXY"),
});
// Repeated wrong passwords cost the caller a cooldown; one account means an
// unthrottled form would otherwise answer guesses as fast as they arrive.
const loginThrottle = makeLoginThrottle();

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

app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_request, body, done) => {
    // A repeated key (several ticked `label` checkboxes) collects into an array;
    // formString still reads one value, the last, as before. No prototype, so a
    // field named __proto__ is just a field.
    const parsed: Record<string, string | string[]> = Object.create(null);
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    for (const [key, value] of new URLSearchParams(rawBody)) {
      const previous = parsed[key];
      parsed[key] =
        previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
    }
    done(null, parsed);
  }
);

function requestPath(req: FastifyRequest): string {
  return new URL(req.url, "http://localhost").pathname;
}

function safeRedirectPath(value: string | null): string {
  // Browsers read a backslash as a slash in a URL path, so "/\evil.com" leaves
  // the site exactly like "//evil.com" does.
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (value === "/_login" || value.startsWith("/_login?")) return "/";
  return value;
}

function queryString(query: unknown, field: string): string | null {
  if (!query || typeof query !== "object") return null;
  const value = (query as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/** Every value of a repeated query parameter (`?label=a&label=b`), in order. */
function queryStrings(query: unknown, field: string): string[] {
  if (!query || typeof query !== "object") return [];
  const value = (query as Record<string, unknown>)[field];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      continue;
    }
  }

  return cookies;
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

/**
 * Constant-time string comparison. Both sides are digested first so the compare
 * always runs over two 32-byte buffers: `timingSafeEqual` throws on a length
 * mismatch, and short-circuiting on one would time out the secret's length.
 */
function timingSafeEqualString(left: string, right: string): boolean {
  const digest = (value: string) =>
    crypto.createHash("sha256").update(value, "utf8").digest();
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function createSession(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
      user: username,
    }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(token: string | undefined): string | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeEqualString(signature, sign(payload))) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
      user?: unknown;
    };
    if (parsed.user !== AUTH_USERNAME) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed.user;
  } catch {
    return null;
  }
}

function currentUser(req: FastifyRequest): string | null {
  return readSession(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
}

/**
 * `Secure` is set from the scheme the request arrived on rather than hardcoded
 * either way. Over HTTPS it keeps the session off any cleartext hop; over the
 * default loopback HTTP it must stay off, because a browser drops a `Secure`
 * cookie sent in the clear and the sign-in would silently never take.
 */
function cookieAttributes(req: FastifyRequest): string {
  return `Path=/; HttpOnly; SameSite=Lax${req.protocol === "https" ? "; Secure" : ""}`;
}

function sessionCookie(token: string, req: FastifyRequest): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(
    req
  )}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function clearSessionCookie(req: FastifyRequest): string {
  // Same attributes as the cookie being cleared, or the browser keeps the old one.
  return `${SESSION_COOKIE}=; ${cookieAttributes(req)}; Max-Age=0`;
}

app.addHook("onRequest", async (req, reply) => {
  if (AUTH_DISABLED) return;
  const reqPath = requestPath(req);
  if (reqPath === "/_login") return;
  if (PUBLIC_PATHS.has(reqPath)) return; // site icons load before sign-in
  // Carries no KB data, and a tab left on the sign-in page is still open.
  if (DESKTOP && reqPath === "/_presence") return;
  if (currentUser(req)) return;

  const next = encodeURIComponent(req.url || "/");
  return reply.redirect(`/_login?next=${next}`, 303);
});

// With sign-in off there is no session for a forged request to lack, so any
// page in the browser could otherwise post forms here or, by DNS rebinding,
// read the KB. The browser's own Host/Origin headers tell those apart.
app.addHook("onRequest", async (req, reply) => {
  if (!AUTH_DISABLED) return;
  const secFetchSite = req.headers["sec-fetch-site"];
  const refusal = crossSiteRefusal({
    method: req.method,
    host: req.headers.host,
    origin: req.headers.origin,
    secFetchSite: Array.isArray(secFetchSite) ? secFetchSite[0] : secFetchSite,
  });
  if (refusal) return reply.code(403).type("text/plain").send(refusal);
});

// Register @fastify/static once with no route of its own (`serve: false`), just
// to decorate reply with sendFile so a per-call rootOverride can target each
// space's _assets dir.
await app.register(fastifyStatic, {
  root: KB_DIR,
  serve: false,
  decorateReply: true,
});

// Per-space attachments: kb/<space>/_assets/* served at /<space>/_assets/*.
// find-my-way ranks the literal `_assets` segment above the `/*` page
// catch-all, so page routing is unaffected. Sits behind the auth hook.
app.get("/:space/_assets/*", async (req, reply) => {
  const params = req.params as { space: string; "*": string };
  const space = content.spaceKeyOf(params.space);
  const assetsRoot = path.join(KB_DIR, space, "_assets");
  if (
    !space ||
    space.startsWith(".") ||
    space.startsWith("_") ||
    !isInsideDir(KB_DIR, assetsRoot)
  ) {
    return reply.callNotFound();
  }
  return reply.sendFile(params["*"], assetsRoot);
});

// Bundled site icons (favicons, app icons) served from app/public at the root.
for (const file of PUBLIC_FILES) {
  app.get(`/${file}`, async (_req, reply) => reply.sendFile(file, PUBLIC_DIR));
}

// Mermaid's browser bundle, served straight from node_modules so diagram pages
// can render client-side while the viewer stays fully self-contained/offline.
// Loaded from an already-authenticated page, so it passes the onRequest gate.
const MERMAID_DIST = path.join(__dirname, "..", "node_modules", "mermaid", "dist");
app.get("/_vendor/mermaid/*", async (req, reply) => {
  const rel = (req.params as { "*": string })["*"];
  if (!isInsideDir(MERMAID_DIST, path.join(MERMAID_DIST, rel))) {
    return reply.callNotFound();
  }
  return reply.sendFile(rel, MERMAID_DIST);
});

// KaTeX's stylesheet and the fonts it names, for the formulas markdown.ts
// typesets on the server. No script: the page arrives already laid out.
const KATEX_DIST = path.join(__dirname, "..", "node_modules", "katex", "dist");
app.get("/_vendor/katex/*", async (req, reply) => {
  const rel = (req.params as { "*": string })["*"];
  const allowed = rel === "katex.min.css" || /^fonts\/[\w-]+\.(woff2|woff|ttf)$/.test(rel);
  if (!allowed || !isInsideDir(KATEX_DIST, path.join(KATEX_DIST, rel))) {
    return reply.callNotFound();
  }
  return reply.sendFile(rel, KATEX_DIST);
});

// The feedback dialog's browser modules (@elmir-mamedov/feedback, imported by
// views.ts), served like Mermaid's bundle: from node_modules, so the dialog
// needs no CDN.
const FEEDBACK_DIST = path.join(__dirname, "..", "node_modules", "@elmir-mamedov", "feedback", "dist");
app.get("/_vendor/feedback/*", async (req, reply) => {
  const rel = (req.params as { "*": string })["*"];
  if (!rel.endsWith(".js") || !isInsideDir(FEEDBACK_DIST, path.join(FEEDBACK_DIST, rel))) {
    return reply.callNotFound();
  }
  return reply.sendFile(rel, FEEDBACK_DIST);
});

/** Best-effort git commit date+time for a file; falls back to null. */
async function gitUpdated(fsPath: string): Promise<string | null> {
  if (!(await git.hasGit())) return null;
  try {
    // History lives in the file's per-space repo, not at the KB root.
    const repoRoot = git.spaceRepoRoot(fsPath);
    const rel = path.relative(repoRoot, fsPath);
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--date=format:%Y-%m-%d %H:%M", "--format=%cd", "--", rel],
      { cwd: repoRoot }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitCommitPage(fsPath: string): Promise<string | null> {
  const rel = git.kbRelPath(fsPath);
  return git.commitFiles([fsPath], `Update ${rel} via web`);
}

function archiveCommitMessage(action: "Archive" | "Restore", mutation: ArchiveMutation): string {
  const target = mutation.isSection ? mutation.slug : git.kbRelPath(mutation.fsPath);
  return `${action} ${target} via web`;
}

function createCommitMessage(mutation: CreatePageMutation): string {
  return `Create ${git.kbRelPath(mutation.fsPath)} via web`;
}

function deleteCommitMessage(mutation: DeleteMutation): string {
  const target = mutation.isSection ? mutation.slug : git.kbRelPath(mutation.fsPath);
  return `Delete ${target} via web`;
}

function moveCommitMessage(mutation: MoveMutation): string {
  return `Move ${mutation.oldSlug} to ${mutation.newSlug} via web`;
}

function moveBatchCommitMessage(moves: MoveMutation[]): string {
  if (moves.length === 1) return moveCommitMessage(moves[0]);
  const parent = moves[0].newSlug.split("/").slice(0, -1).join("/") || "root";
  return `Move ${moves.length} pages to ${parent} via web`;
}

/**
 * One drag onto an insertion line can both re-parent and renumber, so the message
 * names whichever half is the point: a plain arrangement inside one group, or the
 * move that carried the page there (the renumbering rides along in the same commit).
 */
function reorderCommitMessage(mutation: ReorderMutation): string {
  if (mutation.moves.length === 0) {
    return `Reorder pages in ${mutation.parentSlug} via web`;
  }
  if (mutation.moves.length === 1) {
    return `Move ${mutation.moves[0].oldSlug} to ${mutation.moves[0].newSlug} via web`;
  }
  return `Move ${mutation.moves.length} pages to ${mutation.parentSlug} via web`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formString(body: unknown, field: string): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[field];
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === "string" ? last : null;
  }
  return typeof value === "string" ? value : null;
}

/** Every value a form sent under one name (ticked checkboxes), in order. */
function formStrings(body: unknown, field: string): string[] {
  if (!body || typeof body !== "object") return [];
  const value = (body as Record<string, unknown>)[field];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The space a key names, or null. Membership in the space list doubles as the
 * traversal guard: spaceKeyOf("../etc") yields "..", which is not a space.
 */
async function findSpace(key: string): Promise<SpaceInfo | null> {
  const clean = content.spaceKeyOf(key);
  if (!clean) return null;
  return (await content.spaces("all")).find((s) => s.key === clean) ?? null;
}

/**
 * What every page with a sidebar draws around its content in one space: the
 * navigation tree, and the label palette that colours the dots in it.
 */
async function spaceChrome(
  spaceKey: string,
  filter: TreeFilter = "live"
): Promise<{ tree: PageNode[]; labelSet: LabelDef[] }> {
  const [tree, labelSet] = await Promise.all([
    content.spaceTree(spaceKey, filter),
    loadLabelSet(content, spaceKey),
  ]);
  return { tree, labelSet };
}

function pagePath(slug: string): string {
  if (!slug) return "/";
  return "/" + slug.split("/").map(encodeURIComponent).join("/");
}

/** True when `child` resolves to `parent` itself or a path beneath it (no traversal). */
function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Depth-first search for a node by slug within a (possibly nested) tree. */
function findNode(nodes: PageNode[], slug: string): PageNode | null {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    const hit = findNode(n.children, slug);
    if (hit) return hit;
  }
  return null;
}

/** True when the slug resolves to a folder (a pure container with no body). */
async function slugIsFolder(slug: string): Promise<boolean> {
  const page = await content.load(slug);
  return page ? isFolderPage(page.data) : false;
}

async function renderPage(
  slug: string,
  options: { notice?: ViewNotice } = {}
): Promise<{ status: number; html: string }> {
  const [spaces, titles, ids, page] = await Promise.all([
    content.spaces(),
    content.titleIndex(),
    content.idIndex(),
    content.load(slug),
  ]);

  if (!page) {
    return {
      status: 404,
      html: notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME),
    };
  }

  const spaceKey = content.spaceKeyOf(page.slug);
  const { tree, labelSet } = await spaceChrome(spaceKey);

  // A folder is a pure container: render its contents listing, never prose.
  if (isFolderPage(page.data)) {
    const node = findNode(tree, page.slug);
    const html = folderLayout({
      siteTitle: SITE_TITLE,
      spaces,
      spaceKey,
      tree,
      labelSet,
      activeSlug: page.slug,
      titles,
      title: page.data.title,
      children: node?.children ?? [],
      isArchived: page.data.archived === true,
      archivedAt: page.data.archivedAt,
      notice: options.notice,
      username: AUTH_USERNAME,
    });
    return { status: 200, html };
  }

  const md = createRenderer((s) => titles.get(s), page.slug, (id) => ids.get(id));
  // The renderer parks the page's headings on `env` as it goes, so the rail and
  // the HTML it indexes come out of one pass and cannot disagree.
  const env: Record<string, unknown> = {};
  const contentHtml = md.render(page.body, env);
  const updated = await gitUpdated(page.fsPath);
  // The renderer stamps each note's id onto the block it belongs to; the client
  // needs the notes themselves to draw them. A note's own words can carry links
  // — a wiki-link to the page that answers it is the common one — so they are
  // resolved here, through the page's own renderer, and shipped as segments the
  // client can turn into anchors without ever handling markup.
  const notes = parseNotes(page.body).map((note) => {
    const segments = noteSegments(md, note.text, spaceKey);
    return segments.some((segment) => segment.href) ? { ...note, segments } : note;
  });
  // The rail lists h2 and h3. Deeper headings are still linkable — they get an
  // id and a copy affordance like every other — but listing them turns the rail
  // into a second copy of the page. An h1 in the body just repeats the title
  // already standing above it.
  const sections = ((env.kb25Sections as Section[] | undefined) ?? []).filter(
    (s) => s.level === 2 || s.level === 3
  );

  const html = layout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey,
    tree,
    labelSet,
    activeSlug: page.slug,
    titles,
    title: page.data.title,
    labels: cleanLabelNames(page.data.labels ?? []),
    tags: page.data.tags,
    contentHtml,
    sections,
    notes,
    updated,
    isArchived: page.data.archived === true,
    archivedAt: page.data.archivedAt,
    notice: options.notice,
    username: AUTH_USERNAME,
  });
  return { status: 200, html };
}

async function renderArchiveBrowser(): Promise<string> {
  const [spaces, archiveTree, titles] = await Promise.all([
    content.spaces(),
    content.tree("archived"),
    content.titleIndex(),
  ]);

  return archiveLayout({
    siteTitle: SITE_TITLE,
    spaces,
    archiveTree,
    titles,
    username: AUTH_USERNAME,
  });
}

/**
 * The notes dashboard for one space: its open task notes, counted and grouped.
 *
 * `archived` widens the tree filter the way `/_search` does — a `live` tree drops
 * an archived space's own node and every page under it, so a dashboard scoped to
 * one would report nothing at all.
 */
async function renderNotesDashboard(
  spaceKey: string,
  spaceTitle: string,
  archived: boolean
): Promise<string> {
  const filter = archived ? "all" : "live";
  const [spaces, { tree, labelSet }, titles, notes] = await Promise.all([
    content.spaces(),
    spaceChrome(spaceKey, filter),
    content.titleIndex(),
    collectNotes(content, filter, { space: spaceKey, kind: "task" }),
  ]);

  return dashboardLayout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey,
    tree,
    labelSet,
    titles,
    spaceTitle,
    groups: groupNotesByPage(notes),
    summary: summarizeNotes(notes),
    now: Date.now(),
    username: AUTH_USERNAME,
  });
}

/**
 * The Dashboards hub for one space: a card per report, each carrying the
 * number that sums it up. Same archived-space widening as the reports.
 */
async function renderDashboardsHub(space: SpaceInfo): Promise<string> {
  const filter = space.archived ? "all" : "live";
  const [spaces, tree, titles, tasks, labelSet, nodes] = await Promise.all([
    content.spaces(),
    content.spaceTree(space.key, filter),
    content.titleIndex(),
    collectNotes(content, filter, { space: space.key, kind: "task" }),
    loadLabelSet(content, space.key),
    spaceNodes(content, space.key, filter),
  ]);
  const query = `?space=${encodeURIComponent(space.key)}`;
  const taskCount = summarizeNotes(tasks).total;
  const labelledCount = filterLabelled(nodes, []).length;
  const labelCount = knownLabels(labelSet, nodes).length;

  return dashboardsLayout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey: space.key,
    tree,
    labelSet,
    titles,
    spaceTitle: space.title,
    cards: [
      {
        href: `/_dashboard/tasks${query}`,
        title: "Open tasks",
        description: "Task notes left on pages in this space, grouped by page.",
        value: String(taskCount),
        valueLabel: taskCount === 1 ? "open task" : "open tasks",
      },
      {
        href: labelsHref(space.key),
        title: "Labels",
        description: `${labelCount} ${labelCount === 1 ? "label" : "labels"} in this space. Filter and search pages by label.`,
        value: String(labelledCount),
        valueLabel: labelledCount === 1 ? "labelled page" : "labelled pages",
      },
    ],
    username: AUTH_USERNAME,
  });
}

/**
 * The Labels view for one space. With a query it is a search narrowed to the
 * ticked labels, ranked like the sidebar's; without one it lists every page
 * carrying them, in navigation order, each with its summary.
 */
async function renderLabelsDashboard(
  space: SpaceInfo,
  selected: string[],
  query: string,
  notice?: ViewNotice
): Promise<string> {
  const filter = space.archived ? "all" : "live";
  const [spaces, tree, titles, labelSet, nodes] = await Promise.all([
    content.spaces(),
    content.spaceTree(space.key, filter),
    content.titleIndex(),
    loadLabelSet(content, space.key),
    spaceNodes(content, space.key, filter),
  ]);

  // A label named in the URL that no page carries any more still shows as a
  // ticked chip, so the reader can see why nothing matched and untick it.
  const known = knownLabels(labelSet, nodes);
  for (const name of selected) {
    if (known.some((k) => labelKey(k.name) === labelKey(name))) continue;
    known.push({ name, color: "gray", defined: false, count: 0 });
  }

  let results: LabelResult[];
  if (searchTokens(query).length) {
    const hits = await searchPages(content, query, {
      space: space.key,
      filter,
      labels: selected,
      limit: LABELS_SEARCH_LIMIT,
    });
    results = hits.map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      labels: hit.labels,
      text: hit.excerpt,
    }));
  } else {
    const matches = filterLabelled(nodes, selected);
    results = await mapWithConcurrency(matches, 32, async (node) => {
      let summary: string | undefined;
      try {
        summary = (await content.load(node.slug))?.data.summary;
      } catch {
        /* unreadable frontmatter — list it without a summary */
      }
      return { slug: node.slug, title: node.title, labels: node.labels ?? [], text: summary };
    });
  }

  return labelsDashboardLayout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey: space.key,
    tree,
    titles,
    spaceTitle: space.title,
    labelSet,
    known,
    selected,
    query,
    results,
    notice,
    username: AUTH_USERNAME,
  });
}

async function renderSystemNotice(title: string, notice: ViewNotice): Promise<string> {
  const [spaces, titles] = await Promise.all([content.spaces(), content.titleIndex()]);
  return layout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey: "",
    tree: [],
    activeSlug: "",
    titles,
    title,
    contentHtml: `<p>${escapeHtml(notice.text)}</p>`,
    canEdit: false,
    notice,
    username: AUTH_USERNAME,
  });
}

async function renderEditPage(
  slug: string,
  options: { raw?: string; error?: string; notice?: string } = {}
): Promise<{ status: number; html: string }> {
  const [spaces, titles, page] = await Promise.all([
    content.spaces(),
    content.titleIndex(),
    content.loadRaw(slug),
  ]);

  if (!page) {
    return {
      status: 404,
      html: notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME),
    };
  }

  const spaceKey = content.spaceKeyOf(page.slug);
  const { tree, labelSet } = await spaceChrome(spaceKey);
  const fallbackTitle = page.slug.split("/").pop() || "Home";

  // A space's instructions file is deliberately absent from the title index (the
  // tree walk skips `_`-prefixed entries), so name it here rather than falling
  // back to the raw "_instructions" leaf.
  const isInstructions = isInstructionsSlug(page.slug);
  const spaceTitle = spaces.find((s) => s.key === spaceKey)?.title ?? spaceKey;

  const html = editLayout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey,
    tree,
    labelSet,
    activeSlug: page.slug,
    titles,
    title: isInstructions
      ? `${spaceTitle} instructions`
      : titles.get(page.slug) ?? fallbackTitle,
    raw: options.raw ?? page.raw,
    error: options.error,
    notice: options.notice,
    username: AUTH_USERNAME,
    instructions: isInstructions ? { cap: CHAR_CAP, spaceTitle } : undefined,
  });
  return { status: options.error ? 400 : 200, html };
}

async function renderDiffPage(
  slug: string,
  revIndex: number
): Promise<{ status: number; html: string }> {
  const [spaces, titles, page] = await Promise.all([
    content.spaces(),
    content.titleIndex(),
    content.load(slug),
  ]);

  if (!page) {
    return {
      status: 404,
      html: notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME),
    };
  }

  const spaceKey = content.spaceKeyOf(page.slug);
  const { tree, labelSet } = await spaceChrome(spaceKey);

  const commits = await git.fileCommits(page.fsPath);
  // Clamp the requested revision into range; 0 is the latest edit.
  const clamped = commits.length
    ? Math.min(Math.max(revIndex, 0), commits.length - 1)
    : 0;
  const commit = commits[clamped];
  const lines = commit
    ? parseWordDiff(await git.showWordDiff(page.fsPath, commit.sha, commit.pathAtCommit))
    : [];

  const html = diffLayout({
    siteTitle: SITE_TITLE,
    spaces,
    spaceKey,
    tree,
    labelSet,
    activeSlug: page.slug,
    titles,
    title: page.data.title,
    commitCount: commits.length,
    revIndex: clamped,
    revDate: commit?.date ?? null,
    revSubject: commit?.subject ?? null,
    lines,
    username: AUTH_USERNAME,
  });
  return { status: 200, html };
}

async function renderDeletePage(slug: string): Promise<{ status: number; html: string }> {
  const [spaces, titles, preview] = await Promise.all([
    content.spaces(),
    content.titleIndex(),
    content.deletePreview(slug),
  ]);

  if (!preview) {
    return {
      status: 404,
      html: notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME),
    };
  }

  const spaceKey = content.spaceKeyOf(preview.slug);
  const { tree, labelSet } = await spaceChrome(spaceKey);
  return {
    status: 200,
    html: deleteLayout({
      siteTitle: SITE_TITLE,
      spaces,
      spaceKey,
      tree,
      labelSet,
      activeSlug: preview.slug,
      titles,
      title: preview.title,
      fsPath: preview.fsPath,
      isSection: preview.isSection,
      affectedCount: preview.affectedFsPaths.length,
      username: AUTH_USERNAME,
    }),
  };
}

app.get("/_login", async (req, reply) => {
  const next = safeRedirectPath(queryString(req.query, "next"));
  if (AUTH_DISABLED || currentUser(req)) return reply.redirect(next);

  return reply.type("text/html").send(
    loginLayout({
      siteTitle: SITE_TITLE,
      next,
    })
  );
});

app.post("/_login", async (req, reply) => {
  const next = safeRedirectPath(formString(req.body, "next"));
  if (AUTH_DISABLED) return reply.redirect(next, 303);
  const username = formString(req.body, "username") ?? "";
  const password = formString(req.body, "password") ?? "";

  /** The cooled-off form: 429 so a caller's tooling sees the refusal for what it is. */
  const lockedOut = (retryAfterSeconds: number) =>
    reply
      .code(429)
      .header("retry-after", String(retryAfterSeconds))
      .type("text/html")
      .send(
        loginLayout({
          siteTitle: SITE_TITLE,
          error: `Too many failed sign-ins. Try again in ${retryAfterWords(
            retryAfterSeconds
          )}.`,
          next,
          username,
        })
      );

  // Asked before the password is read, so a locked-out caller learns nothing
  // from the answer it gets.
  const gate = loginThrottle.check(req.ip);
  if (!gate.allowed) return lockedOut(gate.retryAfterSeconds);

  // Both compared, and neither with `===`: `&&` would skip the password check on
  // a wrong username, timing out which half was wrong, and a plain `===` returns
  // as soon as two bytes differ, timing out how much of a guess was right.
  const usernameOk = timingSafeEqualString(username, AUTH_USERNAME);
  const passwordOk = timingSafeEqualString(password, AUTH_PASSWORD);
  if (usernameOk && passwordOk) {
    loginThrottle.recordSuccess(req.ip);
    return reply
      .header("set-cookie", sessionCookie(createSession(username), req))
      .redirect(next, 303);
  }

  const after = loginThrottle.recordFailure(req.ip);
  if (!after.allowed) return lockedOut(after.retryAfterSeconds);

  return reply.code(401).type("text/html").send(
    loginLayout({
      siteTitle: SITE_TITLE,
      error: "The username or password is incorrect.",
      next,
      username,
    })
  );
});

app.post("/_logout", async (req, reply) => {
  return reply.header("set-cookie", clearSessionCookie(req)).redirect("/_login", 303);
});

app.post("/_create", async (req, reply) => {
  const parentSlug = formString(req.body, "parentSlug") ?? "";
  let mutation: CreatePageMutation;
  try {
    mutation = await content.createDraft(parentSlug);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    return reply
      .code(500)
      .type("text/html")
      .send(await renderSystemNotice("Create failed", notice));
  }

  try {
    if (mutation.changedFsPaths) {
      await git.commitMovedPaths(mutation.changedFsPaths, createCommitMessage(mutation));
    } else {
      await git.commitFiles([mutation.fsPath], createCommitMessage(mutation));
    }
  } catch (err) {
    const { html } = await renderEditPage(mutation.slug, {
      error: `Created, but Git commit failed: ${errorMessage(err)}`,
    });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(`/_edit${pagePath(mutation.slug)}`, 303);
});

app.post("/_create-folder", async (req, reply) => {
  const parentSlug = formString(req.body, "parentSlug") ?? "";
  const name = formString(req.body, "name") ?? "";
  let mutation: CreatePageMutation;
  try {
    // A folder is created with its name up front; there is nothing to edit
    // afterwards, so we land on its listing rather than the markdown editor.
    mutation = await content.createFolder(parentSlug, name);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    return reply
      .code(500)
      .type("text/html")
      .send(await renderSystemNotice("Create failed", notice));
  }

  try {
    if (mutation.changedFsPaths) {
      await git.commitMovedPaths(mutation.changedFsPaths, createCommitMessage(mutation));
    } else {
      await git.commitFiles([mutation.fsPath], createCommitMessage(mutation));
    }
  } catch (err) {
    const notice = {
      tone: "error",
      text: `Created, but Git commit failed: ${errorMessage(err)}`,
    } satisfies ViewNotice;
    const { html } = await renderPage(mutation.slug, { notice });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(pagePath(mutation.slug), 303);
});

// Rename a folder's display name in place (its URL slug does not change).
app.post("/_rename-folder", async (req, reply) => {
  const slug = formString(req.body, "slug") ?? "";
  const name = formString(req.body, "name") ?? "";

  let mutation: Awaited<ReturnType<typeof content.renameFolder>>;
  try {
    mutation = await content.renameFolder(slug, name);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    const { html } = await renderPage(slug, { notice });
    return reply.code(400).type("text/html").send(html);
  }
  if (!mutation) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }

  try {
    // Empty changedFsPaths means the name was unchanged — skip the commit.
    if (mutation.changedFsPaths.length) {
      await git.commitFiles(mutation.changedFsPaths, `Rename folder ${mutation.slug} via web`);
    }
  } catch (err) {
    const notice = {
      tone: "error",
      text: `Renamed, but Git commit failed: ${errorMessage(err)}`,
    } satisfies ViewNotice;
    const { html } = await renderPage(mutation.slug, { notice });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(pagePath(mutation.slug), 303);
});

/**
 * Set a page's labels from the sidebar's label dialog: the ticked names, plus
 * an optional new label to define and apply in the same step. Lands back on
 * the page the dialog was opened from, which need not be the labelled one.
 */
app.post("/_labels/page", async (req, reply) => {
  const slug = (formString(req.body, "slug") ?? "").trim();
  const names = formStrings(req.body, "label");
  const newName = formString(req.body, "newName") ?? "";
  const newColor = formString(req.body, "newColor") ?? "gray";
  const returnTo = formString(req.body, "returnTo");
  const back = returnTo ? safeRedirectPath(returnTo) : pagePath(slug);

  let mutation: Awaited<ReturnType<typeof applyPageLabels>>;
  try {
    mutation = await applyPageLabels(
      content,
      slug,
      names,
      newName.trim() ? { name: newName, color: newColor } : undefined
    );
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    const { status, html } = await renderPage(slug, { notice });
    return reply.code(status === 404 ? 404 : 400).type("text/html").send(html);
  }
  if (!mutation) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }

  try {
    if (mutation.changedFsPaths.length) {
      const fsPath = await content.resolve(slug);
      const target = fsPath ? git.kbRelPath(fsPath) : slug;
      await git.commitFiles(mutation.changedFsPaths, `Label ${target} via web`);
    }
  } catch (err) {
    const notice = {
      tone: "error",
      text: `Labels saved, but Git commit failed: ${errorMessage(err)}`,
    } satisfies ViewNotice;
    const { html } = await renderPage(slug, { notice });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(back, 303);
});

app.post("/_create-space", async (req, reply) => {
  const title = formString(req.body, "title") ?? "";
  let mutation: CreatePageMutation;
  try {
    mutation = await content.createSpace(title);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    return reply
      .code(400)
      .type("text/html")
      .send(
        spacesLayout({
          siteTitle: SITE_TITLE,
          spaces: await content.spaces(),
          notice,
          username: AUTH_USERNAME,
        })
      );
  }

  try {
    // A new space is its own git repo: initialize it before committing the
    // scaffolding (index.md, _assets/.gitkeep, .gitignore) into it.
    await git.initSpaceRepo(mutation.slug);
    await git.commitFiles(
      mutation.changedFsPaths ?? [mutation.fsPath],
      createCommitMessage(mutation)
    );
  } catch (err) {
    const { html } = await renderEditPage(mutation.slug, {
      error: `Created, but Git commit failed: ${errorMessage(err)}`,
    });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(`/_edit${pagePath(mutation.slug)}`, 303);
});

// --- Space management from the home grid ---------------------------------
// The ⋯ menu on each space card posts here. All three actions land back on the
// spaces home ("/"): the grid is where the user was, and the acted-on space has
// either changed name, dropped off the live grid (archived), or vanished.

async function renderSpacesPage(
  reply: FastifyReply,
  status: number,
  extra: { notice?: ViewNotice; confirmDelete?: { key: string; title: string } } = {}
): Promise<FastifyReply> {
  return reply
    .code(status)
    .type("text/html")
    .send(
      spacesLayout({
        siteTitle: SITE_TITLE,
        spaces: await content.spaces(),
        username: AUTH_USERNAME,
        ...extra,
      })
    );
}

// Edit a space's display name in place (its key/URL is stable).
app.post("/_rename-space", async (req, reply) => {
  const key = formString(req.body, "key") ?? "";
  const title = formString(req.body, "title") ?? "";

  let mutation: Awaited<ReturnType<typeof content.renameSpace>>;
  try {
    mutation = await content.renameSpace(key, title);
  } catch (err) {
    return renderSpacesPage(reply, 400, {
      notice: { tone: "error", text: errorMessage(err) },
    });
  }
  if (!mutation) {
    return renderSpacesPage(reply, 404, {
      notice: { tone: "error", text: `No space named "${key}".` },
    });
  }

  try {
    // Empty changedFsPaths means the name was unchanged — skip the commit.
    if (mutation.changedFsPaths.length) {
      await git.commitFiles(mutation.changedFsPaths, `Rename space ${mutation.key} via web`);
    }
  } catch (err) {
    return renderSpacesPage(reply, 500, {
      notice: { tone: "error", text: `Renamed, but Git commit failed: ${errorMessage(err)}` },
    });
  }

  return reply.redirect("/", 303);
});

// Archive a whole space: marks every page in it archived (reusing the page
// archive path) so it drops off the live grid but stays restorable.
app.post("/_archive-space", async (req, reply) => {
  const key = formString(req.body, "key") ?? "";
  if (!key || key.includes("/")) {
    return renderSpacesPage(reply, 400, {
      notice: { tone: "error", text: "Only a top-level space can be archived here." },
    });
  }

  let mutation: ArchiveMutation | null;
  try {
    mutation = await content.updateArchive(key, true);
  } catch (err) {
    return renderSpacesPage(reply, 400, {
      notice: { tone: "error", text: errorMessage(err) },
    });
  }
  if (!mutation) {
    return renderSpacesPage(reply, 404, {
      notice: { tone: "error", text: `No space named "${key}".` },
    });
  }

  try {
    await git.commitFiles(mutation.changedFsPaths, archiveCommitMessage("Archive", mutation));
  } catch (err) {
    return renderSpacesPage(reply, 500, {
      notice: { tone: "error", text: `Archived, but Git commit failed: ${errorMessage(err)}` },
    });
  }

  return reply.redirect("/", 303);
});

// Deleting a whole space is irreversible (its git repo goes with it), so the
// menu's Delete link lands here first for a confirmation prompt.
app.get("/_delete-space/*", async (req, reply) => {
  const key = content.spaceKeyOf((req.params as { "*": string })["*"] ?? "");
  const space = (await content.spaces("all")).find((s) => s.key === key);
  if (!space) {
    return renderSpacesPage(reply, 404, {
      notice: { tone: "error", text: `No space named "${key}".` },
    });
  }
  return renderSpacesPage(reply, 200, {
    confirmDelete: { key: space.key, title: space.title },
  });
});

app.post("/_delete-space/*", async (req, reply) => {
  const key = (req.params as { "*": string })["*"] ?? "";

  let mutation: Awaited<ReturnType<typeof content.deleteSpace>>;
  try {
    mutation = await content.deleteSpace(key);
  } catch (err) {
    return renderSpacesPage(reply, 400, {
      notice: { tone: "error", text: errorMessage(err) },
    });
  }
  if (!mutation) {
    return renderSpacesPage(reply, 404, {
      notice: { tone: "error", text: `No space named "${key}".` },
    });
  }

  return reply.redirect("/", 303);
});

/**
 * The dragged pages a move/reorder request names: either a JSON array (multi-drag)
 * or a lone `sourceSlug`. Returns null when the array is unparseable, which the
 * caller reports as a bad request rather than treating as "nothing selected".
 */
function parseSourceSlugs(body: unknown): string[] | null {
  const rawSlugs = formString(body, "sourceSlugs");
  if (rawSlugs) {
    try {
      const parsed: unknown = JSON.parse(rawSlugs);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s): s is string => typeof s === "string" && s !== "");
    } catch {
      return null;
    }
  }
  const singleSlug = formString(body, "sourceSlug") ?? "";
  return singleSlug ? [singleSlug] : [];
}

app.post("/_move", async (req, reply) => {
  const targetKind = formString(req.body, "targetKind") ?? "";
  const targetSlug = formString(req.body, "targetSlug") ?? "";

  const sourceSlugs = parseSourceSlugs(req.body);
  if (sourceSlugs === null) {
    return reply.code(400).send({ ok: false, error: "Invalid source list." });
  }

  if (sourceSlugs.length === 0) {
    return reply.code(400).send({ ok: false, error: "Missing source page." });
  }
  if (targetKind !== "root" && targetKind !== "page") {
    return reply.code(400).send({ ok: false, error: "Invalid destination." });
  }
  if (targetKind === "page" && !targetSlug) {
    return reply.code(400).send({ ok: false, error: "Missing destination page." });
  }

  let result: BatchMoveMutation;
  try {
    result = await content.movePages(
      sourceSlugs,
      targetKind === "root" ? null : targetSlug
    );
  } catch (err) {
    return reply.code(400).send({ ok: false, error: errorMessage(err) });
  }

  if (result.moves.length === 0) {
    const error = result.failures[0]?.error ?? "Source page not found.";
    return reply.code(result.failures.length ? 400 : 404).send({ ok: false, error });
  }

  try {
    await git.commitMovedPaths(result.changedFsPaths, moveBatchCommitMessage(result.moves));
  } catch (err) {
    return reply.code(500).send({
      ok: false,
      error: `Moved, but Git commit failed: ${errorMessage(err)}`,
      url: pagePath(result.moves[0].newSlug),
    });
  }

  // A partial failure still reports ok (the successful moves landed); the note
  // is surfaced to the user alongside the reload.
  const total = result.moves.length + result.failures.length;
  const failureNote = result.failures.length
    ? `${result.failures.length} of ${total} could not be moved: ${result.failures
        .map((f) => f.error)
        .join("; ")}`
    : undefined;

  return reply.send({
    ok: true,
    moved: result.moves.map((m) => ({ oldSlug: m.oldSlug, newSlug: m.newSlug })),
    slug: result.moves[0].newSlug,
    url: pagePath(result.moves[0].newSlug),
    ...(failureNote ? { error: failureNote } : {}),
  });
});

/**
 * Place pages at an exact spot in a group — the sidebar's insertion-line drop.
 * `parentSlug` is the group (a space key for the top level), `beforeSlug` the
 * sibling to land above, empty to append. Re-parenting and renumbering are one
 * request because one drop can imply both, and they must land in one commit.
 *
 * Fetch-driven like `/_move`, but it answers with the moves rather than a URL to
 * follow: arranging a page the reader is not currently on must not navigate away,
 * so the client reloads in place and only follows a slug that actually changed.
 */
app.post("/_reorder", async (req, reply) => {
  const parentSlug = formString(req.body, "parentSlug") ?? "";
  const beforeSlug = formString(req.body, "beforeSlug") ?? "";

  const sourceSlugs = parseSourceSlugs(req.body);
  if (sourceSlugs === null) {
    return reply.code(400).send({ ok: false, error: "Invalid source list." });
  }
  if (sourceSlugs.length === 0) {
    return reply.code(400).send({ ok: false, error: "Missing source page." });
  }
  if (!parentSlug) {
    return reply.code(400).send({ ok: false, error: "Missing destination group." });
  }

  let result: ReorderMutation;
  try {
    result = await content.reorderPages(sourceSlugs, parentSlug, beforeSlug);
  } catch (err) {
    return reply.code(400).send({ ok: false, error: errorMessage(err) });
  }

  if (result.orderedSlugs.length === 0) {
    const error = result.failures[0]?.error ?? "Source page not found.";
    return reply.code(result.failures.length ? 400 : 404).send({ ok: false, error });
  }

  try {
    await git.commitMovedPaths(result.changedFsPaths, reorderCommitMessage(result));
  } catch (err) {
    return reply.code(500).send({
      ok: false,
      error: `Reordered, but Git commit failed: ${errorMessage(err)}`,
    });
  }

  const total = result.placedSlugs.length + result.failures.length;
  const failureNote = result.failures.length
    ? `${result.failures.length} of ${total} could not be moved: ${result.failures
        .map((f) => f.error)
        .join("; ")}`
    : undefined;

  return reply.send({
    ok: true,
    moved: result.moves.map((m) => ({ oldSlug: m.oldSlug, newSlug: m.newSlug })),
    parentSlug: result.parentSlug,
    orderedSlugs: result.orderedSlugs,
    ...(failureNote ? { error: failureNote } : {}),
  });
});

/**
 * The body line a note should be inserted above.
 *
 * The reader's browser reports the block it was looking at by line *and*
 * fingerprint. The line is used when it still names that same block; otherwise
 * the block is looked up by fingerprint, which survives an edit elsewhere on the
 * page having shifted it up or down. When neither finds it the block is gone,
 * and refusing beats landing the note on whatever prose moved into its place.
 */
function resolveAnchor(body: string, line: number, hash: string): number | null {
  if (!hash) return null;
  const blocks = sourceBlocks(body);
  const atLine = blocks.find((b) => b.line === line);
  if (atLine?.hash === hash) return atLine.line;
  return blocks.find((b) => b.hash === hash)?.line ?? null;
}

/**
 * The note kind a form field names, or undefined if it names none of them.
 *
 * `agent` is missing on purpose: this is the list of kinds a *person* may write,
 * and leaving it out is what keeps an agent note something only an agent can
 * have said. A request naming it reads as naming nothing, so the add branch
 * below falls back to a task the same way it does for a typo.
 */
function noteKindOf(value: string | null): NoteKind | undefined {
  return value === "task" || value === "remark" || value === "highlight" ? value : undefined;
}

/**
 * Add, edit or resolve an inline note. Fetch-driven like `/_move`, because the
 * reader stays on the page rather than navigating away from it.
 *
 * Resolving deletes the note outright: git keeps both the note and the edit it
 * prompted, so there is nothing to gain from leaving a tombstone in the prose.
 */
app.post("/_notes/*", async (req, reply) => {
  const slug = String((req.params as Record<string, string>)["*"] ?? "");
  const page = await content.loadRaw(slug);
  if (!page) return reply.code(404).send({ ok: false, error: "Page not found." });

  const { header, body } = splitFrontmatter(page.raw);
  const relPath = git.kbRelPath(page.fsPath);
  const op = formString(req.body, "op");
  let nextBody: string;
  let message: string;

  if (op === "resolve") {
    const removed = removeNote(body, formString(req.body, "noteId") ?? "");
    if (removed === null) {
      return reply
        .code(409)
        .send({ ok: false, error: "That note is already gone. Reload the page." });
    }
    nextBody = removed;
    message = `Resolve note on ${relPath} via web`;
  } else if (op === "edit") {
    const noteId = formString(req.body, "noteId") ?? "";
    const current = parseNotes(body).find((note) => note.id === noteId);
    if (!current) {
      return reply
        .code(409)
        .send({ ok: false, error: "That note is already gone. Reload the page." });
    }

    // A note from an agent is the agent's own words; a reader can take it down
    // but not put words in its mouth. The client offers no Edit button for one,
    // and this is the same rule where it actually holds.
    if (isAgentNote(current)) {
      return reply.code(403).send({
        ok: false,
        error: "A note from the agent can't be edited — resolve it instead.",
      });
    }

    // An absent or unrecognised kind leaves the note's own rather than quietly
    // retyping it — so whether an empty text is allowed is judged on the kind the
    // note ends up with, not the one it was sent with.
    const kind = noteKindOf(formString(req.body, "kind"));
    const text = (formString(req.body, "text") ?? "").trim();
    if (!text && (kind ?? current.kind) !== "highlight") {
      return reply.code(400).send({ ok: false, error: "Write the note first." });
    }

    // The note keeps its anchor, its id and its timestamp — only what the writer
    // retyped changes.
    const edited = updateNote(body, noteId, { text, kind });
    if (edited === null) {
      return reply
        .code(409)
        .send({ ok: false, error: "That note is already gone. Reload the page." });
    }
    nextBody = edited;
    message = `Edit note on ${relPath} via web`;
  } else {
    // An absent or unrecognised kind reads as a task, the same way the parser
    // reads a hand-written note that names none.
    const kind = noteKindOf(formString(req.body, "kind")) ?? "task";
    const text = (formString(req.body, "text") ?? "").trim();
    const quote = normalizeQuote(formString(req.body, "quote") ?? "");
    // A highlight *is* the marked phrase, so it saves with nothing typed; the
    // other two kinds are messages and would say nothing without one. A highlight
    // with no quote either would be a note with neither words nor a mark.
    if (!text && !(kind === "highlight" && quote)) {
      return reply.code(400).send({ ok: false, error: "Write the note first." });
    }

    const line = resolveAnchor(
      body,
      Number(formString(req.body, "line")),
      formString(req.body, "hash") ?? ""
    );
    if (line === null) {
      return reply
        .code(409)
        .send({ ok: false, error: "This page changed. Reload and try again." });
    }

    nextBody = insertNote(body, line, {
      id: newNoteId(),
      kind,
      at: noteStamp(),
      by: AUTH_USERNAME,
      quote: quote || undefined,
      text,
    });
    message = `Add note to ${relPath} via web`;
  }

  try {
    // Through updateRaw, so a note write is held to the same frontmatter
    // validation and folder rules as any other edit.
    await content.updateRaw(slug, header + nextBody);
  } catch (err) {
    return reply.code(400).send({ ok: false, error: errorMessage(err) });
  }

  try {
    await git.commitFiles([page.fsPath], message);
  } catch (err) {
    return reply
      .code(500)
      .send({ ok: false, error: `Saved, but Git commit failed: ${errorMessage(err)}` });
  }

  return reply.send({ ok: true });
});

/**
 * Type-ahead search for the sidebar box, scoped to one space. Read-only, so GET —
 * which also makes it inspectable with curl and lets the client cancel a
 * superseded request cleanly.
 *
 * Excerpts are returned as plain text plus the query's tokens; the client wraps
 * the matches in <mark> itself. No HTML crosses the wire, so page bodies — the
 * least trustworthy strings in the system — can never inject markup here.
 */
app.get("/_search", async (req, reply) => {
  // Results are derived from authenticated content and change on every edit, so
  // no browser or proxy may keep a copy. Fastify sets no cache headers of its
  // own, which would otherwise leave a bare 200 GET heuristically cacheable.
  reply.header("cache-control", "no-store");

  const query = (queryString(req.query, "q") ?? "").trim();
  if (query.length < SEARCH_MIN_QUERY) {
    return reply.code(400).send({ ok: false, error: "Query is too short." });
  }

  const spaceKey = content.spaceKeyOf(queryString(req.query, "space") ?? "");
  if (!spaceKey) {
    return reply.code(400).send({ ok: false, error: "Missing space." });
  }
  // Membership doubles as the traversal guard: spaceKeyOf("../etc") yields "..",
  // which is not a space, so it 404s rather than escaping the KB.
  const space = (await content.spaces("all")).find((s) => s.key === spaceKey);
  if (!space) {
    return reply.code(404).send({ ok: false, error: `No space named "${spaceKey}".` });
  }

  const rawLimit = queryString(req.query, "limit");
  const parsedLimit = rawLimit === null ? NaN : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), SEARCH_LIMIT_MAX)
    : SEARCH_LIMIT_DEFAULT;

  let hits: SearchHit[];
  try {
    hits = await searchPages(content, query, {
      space: spaceKey,
      limit,
      // A "live" tree drops an archived space's own node, and with it every page
      // beneath — scoping to one would silently return nothing. Its pages are
      // still browsable, so widen the filter for that case alone.
      filter: space.archived ? "all" : "live",
    });
  } catch (err) {
    return reply.code(500).send({ ok: false, error: errorMessage(err) });
  }

  return reply.send({
    ok: true,
    query,
    space: spaceKey,
    tokens: searchTokens(query),
    results: hits.map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      url: pagePath(hit.slug),
      // Middle segments only: the space is implied and the leaf is the title.
      crumb: hit.slug.split("/").slice(1, -1).join(" / "),
      excerpt: hit.excerpt,
    })),
  });
});

app.get("/_archive", async (_req, reply) => {
  return reply.type("text/html").send(await renderArchiveBrowser());
});

/**
 * Open a space's standing instructions for editing.
 *
 * The file has to exist before the editor can open it, so this scaffolds an
 * empty one on first visit, commits it, and hands off to the ordinary page
 * editor — `<space>/_instructions` resolves like any other slug, so saving,
 * diffing and auto-commit all work unchanged from there.
 */
app.get("/_instructions", async (req, reply) => {
  reply.header("cache-control", "no-store");

  const spaceKey = content.spaceKeyOf(queryString(req.query, "space") ?? "");
  if (!spaceKey) return reply.redirect("/", 303);

  // Membership doubles as the traversal guard, as on /_dashboard.
  const space = (await content.spaces("all")).find((s) => s.key === spaceKey);
  if (!space) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, spaceKey, spaces, AUTH_USERNAME));
  }

  try {
    const ensured = await ensureSpaceInstructions(content, space.key);
    if (ensured.created) {
      const commit = await git.commitFiles(
        ensured.changedFsPaths,
        `Create ${git.kbRelPath(ensured.fsPath)} via web`
      );
      if (!commit) req.log?.warn?.("space instructions scaffolded but nothing to commit");
    }
  } catch (err) {
    const { status, html } = await renderEditPage(instructionsSlug(space.key), {
      error: `Could not open the space instructions: ${errorMessage(err)}`,
    });
    return reply.code(status).type("text/html").send(html);
  }

  return reply.redirect(`/_edit/${instructionsSlug(space.key)}`, 303);
});

/**
 * Every dashboard reports on one space, named by `?space=`. The corner button
 * only appears while a space is active and carries its key, so a request
 * without one was typed by hand: send it to the space picker rather than
 * guessing. Null means the reply has already been sent.
 */
async function dashboardSpace(req: FastifyRequest, reply: FastifyReply): Promise<SpaceInfo | null> {
  // Derived from authenticated content and stale the moment a page changes.
  reply.header("cache-control", "no-store");

  const spaceKey = content.spaceKeyOf(queryString(req.query, "space") ?? "");
  if (!spaceKey) {
    reply.redirect("/", 303);
    return null;
  }
  const space = await findSpace(spaceKey);
  if (!space) {
    const spaces = await content.spaces();
    reply.code(404).type("text/html").send(notFound(SITE_TITLE, spaceKey, spaces, AUTH_USERNAME));
    return null;
  }
  return space;
}

/** The Dashboards hub — what the corner button opens. */
app.get("/_dashboard", async (req, reply) => {
  const space = await dashboardSpace(req, reply);
  if (!space) return reply;
  return reply.type("text/html").send(await renderDashboardsHub(space));
});

app.get("/_dashboard/labels", async (req, reply) => {
  const space = await dashboardSpace(req, reply);
  if (!space) return reply;
  const selected = cleanLabelNames(queryStrings(req.query, "label")).slice(0, LABEL_FILTER_MAX);
  const query = (queryString(req.query, "q") ?? "").trim();
  return reply.type("text/html").send(await renderLabelsDashboard(space, selected, query));
});

app.get("/_dashboard/tasks", async (req, reply) => {
  const space = await dashboardSpace(req, reply);
  if (!space) return reply;
  return reply
    .type("text/html")
    .send(await renderNotesDashboard(space.key, space.title, space.archived));
});

async function handleArchiveMutation(
  slug: string,
  archived: boolean,
  reply: FastifyReply
) {
  let mutation: ArchiveMutation | null;
  try {
    mutation = await content.updateArchive(slug, archived);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    if (slug.replace(/^\/+|\/+$/g, "") === "") {
      return reply
        .code(400)
        .type("text/html")
        .send(await renderSystemNotice("Archive blocked", notice));
    }

    const { status, html } = await renderPage(slug, {
      notice,
    });
    if (status === 404) {
      return reply
        .code(400)
        .type("text/html")
        .send(await renderSystemNotice("Archive failed", notice));
    }
    return reply.code(400).type("text/html").send(html);
  }

  if (!mutation) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }

  try {
    await git.commitFiles(
      mutation.changedFsPaths,
      archiveCommitMessage(archived ? "Archive" : "Restore", mutation)
    );
  } catch (err) {
    const verb = archived ? "Archived" : "Restored";
    const { html } = await renderPage(mutation.slug, {
      notice: {
        tone: "error",
        text: `${verb}, but Git commit failed: ${errorMessage(err)}`,
      },
    });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(pagePath(mutation.slug), 303);
}

app.post("/_archive", async (_req, reply) => {
  return handleArchiveMutation("", true, reply);
});

app.post("/_archive/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  return handleArchiveMutation(slug, true, reply);
});

app.post("/_restore", async (_req, reply) => {
  return handleArchiveMutation("", false, reply);
});

app.post("/_restore/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  return handleArchiveMutation(slug, false, reply);
});

app.get("/_delete", async (_req, reply) => {
  const notice = {
    tone: "error",
    text: "The home page cannot be deleted.",
  } satisfies ViewNotice;
  return reply
    .code(400)
    .type("text/html")
    .send(await renderSystemNotice("Delete blocked", notice));
});

app.get("/_delete/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  try {
    const { status, html } = await renderDeletePage(slug);
    return reply.code(status).type("text/html").send(html);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    return reply
      .code(400)
      .type("text/html")
      .send(await renderSystemNotice("Delete blocked", notice));
  }
});

app.post("/_delete", async (_req, reply) => {
  const notice = {
    tone: "error",
    text: "The home page cannot be deleted.",
  } satisfies ViewNotice;
  return reply
    .code(400)
    .type("text/html")
    .send(await renderSystemNotice("Delete blocked", notice));
});

app.post("/_delete/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  let mutation: DeleteMutation | null;

  try {
    mutation = await content.deletePage(slug);
  } catch (err) {
    const notice = { tone: "error", text: errorMessage(err) } satisfies ViewNotice;
    return reply
      .code(400)
      .type("text/html")
      .send(await renderSystemNotice("Delete blocked", notice));
  }

  if (!mutation) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }

  try {
    await git.commitFiles(mutation.deletedFsPaths, deleteCommitMessage(mutation));
  } catch (err) {
    const notice = {
      tone: "error",
      text: `Deleted, but Git commit failed: ${errorMessage(err)}`,
    } satisfies ViewNotice;
    return reply
      .code(500)
      .type("text/html")
      .send(await renderSystemNotice("Delete commit failed", notice));
  }

  // Land on the nearest surviving ancestor (parent page or space) rather than
  // bouncing all the way out to the spaces home.
  let destination = "/";
  let ancestor = mutation.slug.split("/").slice(0, -1).join("/");
  while (ancestor) {
    if (await content.resolve(ancestor)) {
      destination = pagePath(ancestor);
      break;
    }
    ancestor = ancestor.split("/").slice(0, -1).join("/");
  }
  return reply.redirect(destination, 303);
});

// Home: the spaces landing grid (each top-level folder is a space).
app.get("/", async (_req, reply) => {
  const spaces = await content.spaces();
  return reply.type("text/html").send(
    spacesLayout({
      siteTitle: SITE_TITLE,
      spaces,
      username: AUTH_USERNAME,
    })
  );
});

app.get("/_edit/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  // Folders have no editable body — send the user to the folder listing.
  if (await slugIsFolder(slug)) return reply.redirect(pagePath(slug), 303);
  const { status, html } = await renderEditPage(slug);
  return reply.code(status).type("text/html").send(html);
});

app.post("/_edit/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  if (await slugIsFolder(slug)) return reply.redirect(pagePath(slug), 303);
  const markdown = formString(req.body, "markdown");
  if (markdown === null) {
    const { status, html } = await renderEditPage(slug, {
      error: "Missing markdown form field.",
    });
    return reply.code(status).type("text/html").send(html);
  }

  let page;
  try {
    page = await content.updateRaw(slug, markdown);
  } catch (err) {
    const { html } = await renderEditPage(slug, {
      raw: markdown,
      error: `Could not save page: ${errorMessage(err)}`,
    });
    return reply.code(400).type("text/html").send(html);
  }

  if (!page) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }

  // Optional URL-slug change: rename the file/folder after the content is saved.
  let renamed: Awaited<ReturnType<typeof content.renamePage>> = null;
  const newLeaf = formString(req.body, "slug")?.trim();
  if (newLeaf) {
    try {
      renamed = await content.renamePage(page.slug, newLeaf);
    } catch (err) {
      const { html } = await renderEditPage(page.slug, {
        raw: markdown,
        error: `Saved the content, but could not change the URL: ${errorMessage(err)}`,
      });
      return reply.code(400).type("text/html").send(html);
    }
  }

  const didRename = renamed !== null && renamed.newSlug !== renamed.oldSlug;
  try {
    if (didRename) {
      await git.commitMovedPaths(
        renamed!.changedFsPaths,
        `Rename ${renamed!.oldSlug} to ${renamed!.newSlug} via web`
      );
    } else {
      await gitCommitPage(page.fsPath);
    }
  } catch (err) {
    const { html } = await renderEditPage(didRename ? renamed!.newSlug : page.slug, {
      raw: markdown,
      error: `Saved, but Git commit failed: ${errorMessage(err)}`,
    });
    return reply.code(500).type("text/html").send(html);
  }

  return reply.redirect(pagePath(didRename ? renamed!.newSlug : page.slug));
});

// Download a page's raw Markdown (frontmatter included) as an attachment.
app.get("/_download/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  // A folder is a pure container — there is no document to download.
  if (await slugIsFolder(slug)) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }
  const page = await content.loadRaw(slug);
  if (!page) {
    const spaces = await content.spaces();
    return reply
      .code(404)
      .type("text/html")
      .send(notFound(SITE_TITLE, slug.replace(/^\/+/, ""), spaces, AUTH_USERNAME));
  }
  return reply
    .header(
      "content-disposition",
      `attachment; filename="${downloadFilename(page.slug)}"`
    )
    .type("text/markdown; charset=utf-8")
    .send(page.raw);
});

// Word-level diff of a page's edit history; ?rev=N steps back (0 = latest edit).
app.get("/_diff/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  // A folder is a pure container — there is no prose to diff.
  if (await slugIsFolder(slug)) return reply.redirect(pagePath(slug), 303);
  const revRaw = queryString(req.query, "rev");
  const parsed = revRaw === null ? 0 : Number.parseInt(revRaw, 10);
  const revIndex = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const { status, html } = await renderDiffPage(slug, revIndex);
  return reply.code(status).type("text/html").send(html);
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
if (updater) {
  app.get("/_update", async (_req, reply) => reply.send(await updater.status()));
  app.post("/_update", async (_req, reply) => {
    const started = await updater.start();
    if (!started.ok) return reply.code(409).send({ error: started.reason });
    return reply.code(202).send(await updater.status());
  });
}

// Feedback to the developer (feedback.ts). GET answers what a report would
// carry besides the person's own words, for the dialog to show before
// sending; POST sends it through the relay, or queues it when the relay is
// out of reach. KB25_FEEDBACK_RELAY points it elsewhere, e.g. at `wrangler dev`.
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
app.get("/_feedback", async (_req, reply) => reply.send(feedback.info()));
// The dialog posts a report as the multipart the relay takes, read here as
// raw bytes. The parser is scoped to this route; nothing else takes multipart.
await app.register(async (scope) => {
  scope.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  scope.post("/_feedback", { bodyLimit: FEEDBACK_BODY_LIMIT }, async (req, reply) => {
    const result = await feedback.submit(req.body as Buffer, req.headers["content-type"] ?? "");
    return reply.code(result.status === "refused" ? 400 : result.status === "sent" ? 200 : 202).send(result);
  });
});

// Quitting, for a server a launcher started (DESKTOP). Each browser keeps one
// event stream here while it has a KB25 tab open, and the server quits once
// the last one has been gone a while; POST /_quit is the page's Quit button.
const presence = DESKTOP
  ? makePresence({ graceMs: QUIT_GRACE_MS, onIdle: () => void shutdown("no KB25 tabs open", false) })
  : null;
if (presence) {
  app.get("/_presence", async (_req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    // A dropped stream retries soon, so a restart (an update) picks it back up.
    reply.raw.write("retry: 2000\n\n");
    reply.raw.on("close", presence.connect(reply.raw));
  });
  app.post("/_quit", async (_req, reply) => {
    reply.raw.once("finish", () => void shutdown("quit from the page", true));
    return reply.code(202).send({ ok: true });
  });
}

let shuttingDown = false;
/**
 * Stop serving and exit. `quitting` tells the open tabs KB25 has quit; a
 * signal (logout, or an update stopping this server to restart it) leaves
 * them to reconnect instead.
 */
async function shutdown(reason: string, quitting: boolean): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`KB viewer stopping: ${reason}`);
  presence?.endAll(quitting);
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
  process.once(signal, () => void shutdown(signal, false));
}

// Any page by slug (supports nested paths).
app.get("/*", async (req, reply) => {
  const slug = (req.params as { "*": string })["*"] ?? "";
  const { status, html } = await renderPage(slug);
  return reply.code(status).type("text/html").send(html);
});

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

// An update that moved KB25 off a dev-server port (installer/setup.mjs) passes
// the port it left. The page that started the update is still asking that
// port whether the new version is up, so for a few minutes the old port
// answers: /_update as this server would, which has the page reload, and the
// reload with a redirect to the new address. Remove once copies of KB25 0.5.0
// and earlier have updated.
const MOVED_FROM = envNumber("KB25_MOVED_FROM", 0);
if (install && MOVED_FROM && MOVED_FROM !== PORT) {
  const forwarder = Fastify({ logger: false });
  forwarder.addHook("onRequest", async (req, reply) => {
    // The same DNS-rebinding guard as this server's: a loopback Host only.
    const refusal = crossSiteRefusal({ method: "GET", host: req.headers.host });
    if (refusal) return reply.code(403).type("text/plain").send(refusal);
  });
  if (updater) {
    forwarder.get("/_update", async (_req, reply) => reply.header("cache-control", "no-store").send(await updater.status()));
  }
  forwarder.get("/*", async (req, reply) => {
    const target = new URL(req.url, `http://${req.headers.host}`);
    target.port = String(PORT);
    return reply.redirect(target.href, 302);
  });
  try {
    await forwarder.listen({ host: HOST, port: MOVED_FROM });
    console.log(`Forwarding port ${MOVED_FROM}, which KB25 moved from, for 5 minutes`);
    setTimeout(() => void forwarder.close(), 5 * 60_000).unref();
  } catch {
    // Something else took the old port; there is nothing to forward.
  }
}
