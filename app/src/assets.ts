import path from "node:path";

/**
 * How a space's attachments (`/<space>/_assets/*`) are sent to the browser.
 *
 * Assets are served from KB25's own origin, and they arrive the way pages do:
 * pulled from a space's remote or copied in with a folder. A file the browser
 * runs when it is opened, such as an SVG or an HTML page, would run as KB25:
 * it could read every page, edit or delete them, and start chat turns. So no
 * asset is trusted to be harmless, and these headers make sure none can run.
 * The one HTML that does run is a page's widget, and only at `/_embed/…`,
 * inside a sandbox with no network (embedHeaders).
 */

/**
 * Extensions the browser may show in place. None of them can run a script:
 * images, audio and video are shown by the browser's own viewers, plain text
 * as text, and a PDF by the PDF viewer. Everything else, SVG and HTML above
 * all, is downloaded instead. A download stays a download in KB25's own
 * windows too, which save every `attachment` rather than show it.
 */
const INLINE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".txt",
  ".pdf",
]);

/**
 * A sandboxed document gets an origin of its own and runs no script, so even
 * a file shown despite `attachment` can't act as KB25. It may load only itself
 * (an image or a video document loads its own URL) and inline styles.
 */
const ASSET_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

/**
 * Whether an asset is an HTML widget: a figure a page embeds with the image
 * syntax (`![TCP handshake](_assets/tcp-handshake.html)`), which runs in a
 * sandboxed frame (views/widgets.ts). Opened as an asset it still downloads.
 */
export function isWidgetName(name: string): boolean {
  return path.extname(name).toLowerCase() === ".html";
}

/**
 * The policy a widget is sent under at `/_embed/…` (server/widgets.ts), the
 * one route that shows a space's HTML as a page. A widget needs its scripts to
 * move and respond, so it keeps them, but the sandbox gives it an origin of
 * its own, without crescent's pages, storage or sign-in, and it may load
 * nothing and send nothing: no script, style, font or image from anywhere,
 * crescent included, and no request. What it uses is written inside the file
 * (`data:` images and fonts, and a `blob:` it makes itself). Only crescent's
 * own pages may frame it, so no other site can show a widget's contents. No
 * policy stops a document navigating itself, though; views/widgets.ts says
 * what stops a widget that tries.
 */
const EMBED_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "frame-ancestors 'self'",
].join("; ");

/** The headers a widget is sent with at `/_embed/…`. */
export function embedHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": EMBED_CSP,
    "x-content-type-options": "nosniff",
    // An agent rewrites a widget in place, so a reload has to show the new one.
    "cache-control": "no-cache",
  };
}

/** The headers an asset is sent with, chosen by its file name. */
export function assetHeaders(fileName: string): Record<string, string> {
  const ext = path.extname(fileName).toLowerCase();
  // The type comes from the extension; never let the browser guess another.
  const headers: Record<string, string> = { "x-content-type-options": "nosniff" };
  // A browser's PDF viewer is a plugin, which a sandbox or `default-src 'none'`
  // turns off. A PDF's own scripts run inside that viewer, never as the page.
  if (ext === ".pdf") return headers;

  headers["content-security-policy"] = ASSET_CSP;
  if (!INLINE_EXTENSIONS.has(ext)) headers["content-disposition"] = "attachment";
  return headers;
}
