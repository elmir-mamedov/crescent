import path from "node:path";

/**
 * How a space's attachments (`/<space>/_assets/*`) are sent to the browser.
 *
 * Assets are served from KB25's own origin, and they arrive the way pages do:
 * pulled from a space's remote or copied in with a folder. A file the browser
 * runs when it is opened, such as an SVG or an HTML page, would run as KB25:
 * it could read every page, edit or delete them, and start chat turns. So no
 * asset is trusted to be harmless, and these headers make sure none can run.
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
