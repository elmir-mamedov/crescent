/**
 * A space's text assets: the files under `<space>/_assets/` an agent writes
 * from their text rather than copying in, and reads back to change: a widget
 * (`.html`, views/widgets.ts), a drawing (`.svg`) or a table (`.csv`). The MCP
 * server's `kb_write_asset` and `kb_get_asset` are what use them.
 *
 * An image upload never replaces a file (gallery.ts), but writing a text asset
 * replaces the file of that name in place, so a page that shows a widget needs
 * no edit when the widget changes, and no copies pile up. Like the rest of
 * `_assets`, nothing here follows a symbolic link.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Content } from "./content.js";
import { assetsDir, cleanFileBase, isRealDir } from "./gallery.js";

const TEXT_ASSET_EXTENSIONS = [".html", ".svg", ".csv"];

/** The kinds, said the way a refusal names them. */
export const TEXT_ASSET_FORMATS = "HTML (.html), SVG (.svg) or CSV (.csv)";

/**
 * The biggest text asset written or read. A widget or a drawing is far
 * smaller, and every write and read of one goes through a model's context.
 */
export const TEXT_ASSET_LIMIT = 1024 * 1024;

export interface TextAsset {
  /** Where it sits inside `_assets`, with `/` between folders: `figures/tcp.html`. */
  path: string;
  fsPath: string;
}

export interface WrittenTextAsset extends TextAsset {
  /** False when it replaced a file of that name. */
  created: boolean;
}

export function isTextAssetName(name: string): boolean {
  return TEXT_ASSET_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/** A link's path inside `_assets`: what follows a leading `_assets/`, decoded. */
function inAssets(link: string): string {
  const rel = link.trim().replace(/\\/g, "/").replace(/^\/?_assets\//, "");
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

/**
 * Where a text asset named `name` is written inside `_assets`, or null when it
 * does not end in a text asset's extension or has no name left. A leading
 * `_assets/`, as in a page's link, is dropped. Each folder and the name are
 * made lowercase and hyphenated, the way an upload's are, because the path goes
 * into a page as a link.
 */
export function textAssetPath(name: string): string | null {
  const segments = inAssets(name).split("/").filter(Boolean);
  const last = segments.pop();
  if (!last || !isTextAssetName(last)) return null;
  const ext = path.extname(last).toLowerCase();
  const parts = [...segments, last.slice(0, -ext.length)].map(cleanFileBase);
  return parts.some((part) => !part) ? null : parts.join("/") + ext;
}

/** Why `text` can't be written as the asset at `rel`, or null when it can. */
function textRefusal(rel: string, text: string): string | null {
  if (!text.trim()) return "The file is empty: send its whole text as the content.";
  if (Buffer.byteLength(text, "utf8") > TEXT_ASSET_LIMIT) {
    return `The file is over ${TEXT_ASSET_LIMIT / 1024 / 1024} MB, too big to write. Keep a widget or a drawing small.`;
  }
  // The likeliest mistake: a path to the file where its text belongs.
  if (!text.trim().includes("\n") && /^(\/|~\/|[A-Za-z]:[\\/])[^<>]*$/.test(text.trim())) {
    return "Send the file's text as the content, not a path to it. To copy in an image file from this machine, use kb_add_image.";
  }
  if (rel.endsWith(".svg") && !/<svg[\s>]/i.test(text)) return `_assets/${rel} is not an SVG drawing: its text has no <svg> element.`;
  return null;
}

/**
 * Write `text` as the asset `name` in the space's `_assets`, replacing the
 * file of that name if there is one, and making the folders it names. The
 * caller commits the returned `fsPath`. It is written beside its place and
 * renamed into it, so a reader never sees half a file, and a link that turns
 * up at the name is replaced, never written through.
 */
export async function writeTextAsset(
  content: Content,
  spaceKey: string,
  name: string,
  text: string
): Promise<WrittenTextAsset> {
  const root = assetsDir(content, spaceKey);
  if (!root || !(await isRealDir(path.dirname(root)))) {
    throw new Error(`There is no space named "${spaceKey}".`);
  }
  const rel = textAssetPath(name);
  if (!rel) {
    throw new Error(`Name the file for what it shows, ending in .html, .svg or .csv (e.g. tcp-handshake.html), not ${name}.`);
  }
  const refusal = textRefusal(rel, text);
  if (refusal) throw new Error(refusal);

  // One folder at a time, so that none is made through a link to a folder
  // somewhere else, which `mkdir -p` would follow.
  const segments = rel.split("/");
  let dir = path.dirname(root);
  for (const folder of ["_assets", ...segments.slice(0, -1)]) {
    dir = path.join(dir, folder);
    try {
      await fs.mkdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    if (!(await isRealDir(dir))) {
      throw new Error(`${path.relative(path.dirname(root), dir).split(path.sep).join("/")} is not a folder crescent can write to.`);
    }
  }

  const fsPath = path.join(dir, segments[segments.length - 1]);
  const state = await content.fileState(fsPath);
  if (state === "other") throw new Error(`_assets/${rel} is not a file crescent can replace.`);
  // A dot-file, which the asset routes never serve, until it is renamed.
  const temp = path.join(dir, `.${path.basename(fsPath)}.${randomUUID()}.tmp`);
  await fs.writeFile(temp, text, { flag: "wx" });
  try {
    await fs.rename(temp, fsPath);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
  return { path: rel, fsPath, created: state === "missing" };
}

/**
 * The text of the asset a page links as `link` (`_assets/tcp.html`, or just
 * `tcp.html`), or null when the space has no such file. Only a text asset is
 * read, and only one no bigger than a write may make.
 */
export async function readTextAsset(
  content: Content,
  spaceKey: string,
  link: string
): Promise<(TextAsset & { text: string }) | null> {
  const rel = inAssets(link);
  if (!isTextAssetName(rel)) throw new Error(`Only an ${TEXT_ASSET_FORMATS} file can be read this way; ${link} is not one.`);
  const fsPath = await content.resolveAsset(spaceKey, rel);
  if (!fsPath) return null;
  const { size } = await fs.stat(fsPath);
  if (size > TEXT_ASSET_LIMIT) {
    throw new Error(`_assets/${rel} is over ${TEXT_ASSET_LIMIT / 1024 / 1024} MB, too big to read.`);
  }
  return { path: rel.split("/").filter(Boolean).join("/"), fsPath, text: await fs.readFile(fsPath, "utf8") };
}
