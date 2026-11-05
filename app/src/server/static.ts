/**
 * Files sent as they are: each space's attachments, the site icons, and the
 * browser side of Mermaid, KaTeX and the feedback dialog, served from the
 * app's own node_modules so the viewer needs no CDN.
 */
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { assetHeaders } from "../assets.js";
import type { Content } from "../content.js";

export interface StaticOptions {
  kbDir: string;
  content: Content;
  /** The folder holding public/ and node_modules/: a checkout's app/, or an install's. */
  appDir: string;
}

// Site icons bundled with the app, served from the site root so the
// <link rel="icon"> tags and the browser's automatic /favicon.ico lookup
// resolve. Each is registered as a literal route, which find-my-way ranks
// above the `/*` page catch-all.
export const PUBLIC_FILES = [
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
export const PUBLIC_PATHS = new Set(PUBLIC_FILES.map((file) => `/${file}`));

/** True when `child` resolves to `parent` itself or a path beneath it (no traversal). */
function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function registerStaticRoutes(
  app: FastifyInstance,
  { kbDir, content, appDir }: StaticOptions
): Promise<void> {
  // Register @fastify/static once with no route of its own (`serve: false`), just
  // to decorate reply with sendFile so a per-call rootOverride can target each
  // space's _assets dir.
  await app.register(fastifyStatic, {
    root: kbDir,
    serve: false,
    decorateReply: true,
    dotfiles: "deny",
    // Only a file actually being sent gets these, so a 404 page still shows.
    // Everything sent from inside the KB is an asset (assets.ts).
    setHeaders: (res, filePath) => {
      if (!isInsideDir(kbDir, filePath)) return;
      for (const [name, value] of Object.entries(assetHeaders(filePath))) res.setHeader(name, value);
    },
  });

  // Per-space attachments: kb/<space>/_assets/* served at /<space>/_assets/*.
  // find-my-way ranks the literal `_assets` segment above the `/*` page
  // catch-all, so page routing is unaffected. Sits behind the auth hook.
  app.get("/:space/_assets/*", async (req, reply) => {
    const params = req.params as { space: string; "*": string };
    // Refuses dotfiles (`.gitkeep`, a stray `.env`) and anything reached through
    // a symbolic link, which could point anywhere on the machine.
    const fsPath = await content.resolveAsset(params.space, params["*"]);
    if (!fsPath) return reply.callNotFound();
    return reply.sendFile(path.basename(fsPath), path.dirname(fsPath));
  });

  // Bundled site icons (favicons, app icons) served from app/public at the root.
  const PUBLIC_DIR = path.join(appDir, "public");
  for (const file of PUBLIC_FILES) {
    app.get(`/${file}`, async (_req, reply) => reply.sendFile(file, PUBLIC_DIR));
  }

  // Mermaid's browser bundle, served straight from node_modules so diagram pages
  // can render client-side while the viewer stays fully self-contained/offline.
  // Loaded from an already-authenticated page, so it passes the onRequest gate.
  const MERMAID_DIST = path.join(appDir, "node_modules", "mermaid", "dist");
  app.get("/_vendor/mermaid/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    if (!isInsideDir(MERMAID_DIST, path.join(MERMAID_DIST, rel))) {
      return reply.callNotFound();
    }
    return reply.sendFile(rel, MERMAID_DIST);
  });

  // KaTeX's stylesheet and the fonts it names, for the formulas markdown.ts
  // typesets on the server. No script: the page arrives already laid out.
  const KATEX_DIST = path.join(appDir, "node_modules", "katex", "dist");
  app.get("/_vendor/katex/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    const allowed = rel === "katex.min.css" || /^fonts\/[\w-]+\.(woff2|woff|ttf)$/.test(rel);
    if (!allowed || !isInsideDir(KATEX_DIST, path.join(KATEX_DIST, rel))) {
      return reply.callNotFound();
    }
    return reply.sendFile(rel, KATEX_DIST);
  });

  // The feedback dialog's browser modules (@elmir-mamedov/feedback, imported by
  // views/corner.ts), served like Mermaid's bundle: from node_modules, so the
  // dialog needs no CDN.
  const FEEDBACK_DIST = path.join(appDir, "node_modules", "@elmir-mamedov", "feedback", "dist");
  app.get("/_vendor/feedback/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    if (!rel.endsWith(".js") || !isInsideDir(FEEDBACK_DIST, path.join(FEEDBACK_DIST, rel))) {
      return reply.callNotFound();
    }
    return reply.sendFile(rel, FEEDBACK_DIST);
  });
}
