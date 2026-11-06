/**
 * A space's image gallery: every image in `<space>/_assets/`, whether a page
 * shows it or not, and the upload that adds one there.
 *
 * An upload lands where a hand-copied image would, so a page shows it the
 * ordinary way, with `![](_assets/name.png)` in its Markdown. Like everything
 * else that reaches the KB, the files in `_assets` are untrusted: the walk
 * follows no symbolic link, and they reach the browser only through
 * `/<space>/_assets/*`, whose headers (assets.ts) keep any of them from running.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { flatten, type Content } from "./content.js";
import { mapWithConcurrency } from "./search.js";

/**
 * What the gallery counts as an image. The raster formats every browser
 * shows, plus SVG, which an `<img>` shows without running any of its scripts.
 */
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** The upload picker's `accept`: the same extensions, so it offers only what is taken. */
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(",");

/** The formats, said the way the refusal names them. */
export const IMAGE_FORMATS = "PNG, JPEG, GIF, WebP, AVIF or SVG";

/**
 * The most one upload may carry, all its images together. A phone photo or a
 * screen-sized screenshot is a few megabytes, so this takes a handful at once;
 * the server holds the whole upload in memory while it saves it.
 */
export const GALLERY_BODY_LIMIT = 50 * 1024 * 1024;

/** Longest file name an upload is given, before its extension. */
const MAX_BASE_LENGTH = 80;

export interface GalleryImage {
  /** Where the image sits inside `_assets`, with `/` between folders: `diagrams/flow.png`. */
  path: string;
  size: number;
  /** Last modified, in ms since the epoch. */
  modified: number;
}

export interface SavedImage {
  path: string;
  fsPath: string;
}

/** A page that links to an image, so deleting the image would break it. */
export interface ImageLink {
  slug: string;
  title: string;
}

export interface ImageDeletion extends SavedImage {
  /** Pages that still link to the image. When there are any, nothing was deleted. */
  linkedFrom: ImageLink[];
}

export function isImageName(name: string): boolean {
  return Object.hasOwn(IMAGE_TYPES, path.extname(name).toLowerCase());
}

/** The type an image is sent with, by its extension; undefined for anything else. */
export function imageType(name: string): string | undefined {
  const ext = path.extname(name).toLowerCase();
  return Object.hasOwn(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext] : undefined;
}

/** The space's `_assets` folder, or null when the key cannot name a space. */
function assetsDir(content: Content, spaceKey: string): string | null {
  const dir = content.spaceDir(spaceKey);
  return dir ? path.join(dir, "_assets") : null;
}

/** True for a real folder, never one reached through a symbolic link. */
async function isRealDir(dir: string): Promise<boolean> {
  try {
    return (await fs.lstat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every image in a space's `_assets`, its subfolders included, newest first.
 * A space with no `_assets` folder has none. Dot-files and anything that is
 * not a plain file are left out, exactly as `/<space>/_assets/*` refuses them.
 */
export async function listImages(content: Content, spaceKey: string): Promise<GalleryImage[]> {
  const root = assetsDir(content, spaceKey);
  if (!root || !(await isRealDir(path.dirname(root))) || !(await isRealDir(root))) return [];

  const images: GalleryImage[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    // A Dirent describes the entry itself, so a link is neither a file nor a folder.
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fsPath = path.join(dir, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fsPath, entryRel);
      } else if (entry.isFile() && isImageName(entry.name)) {
        const stat = await fs.lstat(fsPath);
        images.push({ path: entryRel, size: stat.size, modified: stat.mtimeMs });
      }
    }
  }
  await walk(root, "");

  return images.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
}

/**
 * The name an upload is saved under, or null when it is not an image the
 * gallery takes. Lowercase and hyphenated, because the name goes into a page
 * as a link (`![](_assets/name.png)`) that a space or bracket would break. An
 * accent keeps its letter (`obrázek` → `obrazek`). A file whose own extension
 * is not an image's is named by its type instead, which is how a pasted
 * screenshot with no extension still arrives as a `.png`.
 */
export function imageFileName(name: string, type: string): string | null {
  const plain = path.basename(name.replace(/\\/g, "/"));
  let ext = path.extname(plain).toLowerCase();
  if (!Object.hasOwn(IMAGE_TYPES, ext)) {
    const byType = Object.keys(IMAGE_TYPES).find((key) => IMAGE_TYPES[key] === type);
    if (!byType) return null;
    ext = byType === ".jpeg" ? ".jpg" : byType;
  }
  const base = plain
    .slice(0, plain.length - path.extname(plain).length)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/^-+|-+$/g, "");
  return `${base || "image"}${ext}`;
}

/** Why an upload is refused before anything is written, or null when every file can be saved. */
export function uploadRefusal(files: readonly { name: string; type: string; size: number }[]): string | null {
  if (!files.length) return "Choose an image to upload.";
  const notImages = files.filter((file) => imageFileName(file.name, file.type) === null);
  if (notImages.length) {
    const names = notImages.map((file) => file.name || "a file with no name").join(", ");
    return `Only images can go in the gallery (${IMAGE_FORMATS}); ${names} is not one.`;
  }
  const empty = files.find((file) => file.size === 0);
  if (empty) return `${empty.name || "The file"} is empty.`;
  return null;
}

/**
 * An image file on this machine, read so it can be saved into a space's
 * `_assets` the way an upload is: what the MCP server's `kb_add_image` copies
 * in. It is held to an upload's rules (an image by its name, not empty, no
 * bigger than a whole upload may be), and a symbolic link is refused, so the
 * path is the file that gets read.
 */
export async function readImageFile(filePath: string): Promise<File> {
  if (!path.isAbsolute(filePath)) throw new Error(`${filePath} is not an absolute path.`);
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new Error(`There is no file at ${filePath}.`);
    throw err;
  }
  if (!stat.isFile()) throw new Error(`${filePath} is not a plain file.`);

  const name = path.basename(filePath);
  const refusal = uploadRefusal([{ name, type: "", size: stat.size }]);
  if (refusal) throw new Error(refusal);
  if (stat.size > GALLERY_BODY_LIMIT) {
    throw new Error(`${name} is over ${GALLERY_BODY_LIMIT / 1024 / 1024} MB, too big to add.`);
  }
  return new File([await fs.readFile(filePath)], name);
}

/**
 * Every page, archived ones included, whose source links to the image at
 * `<space>/_assets/<rel>`. A page of that space links to it as
 * `_assets/<rel>`, a page of any space as `/<space>/_assets/<rel>`; either
 * form may be URL-encoded.
 *
 * This reads the source as text rather than as rendered Markdown, so a
 * reference definition, a note's link and a mention in a code block all
 * count. A page is kept from losing an image it shows at the price of now and
 * then holding on to one it only names. Case is ignored, because the file
 * systems of macOS and Windows ignore it when the image is served.
 */
export async function pagesLinkingTo(content: Content, spaceKey: string, rel: string): Promise<ImageLink[]> {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plain = rel.normalize("NFC");
  const names = [...new Set([plain, encodeURI(plain)])].map(escape).join("|");
  // Not inside a longer name on either side: `my_assets/…` and `plot.png.bak` are other files.
  const end = String.raw`(?![\w-]|\.\w)`;
  const ownSpace = new RegExp(String.raw`(?<![\w-])_assets/(?:${names})${end}`, "iu");
  const anySpace = new RegExp(String.raw`/${escape(spaceKey)}/_assets/(?:${names})${end}`, "iu");

  // The KB's home page, when it has one, sits above every space and is not in the tree.
  const pages = [{ slug: "", title: "Home" }, ...flatten(await content.tree("all"))];
  const linking = await mapWithConcurrency(pages, 32, async ({ slug, title }) => {
    const page = await content.loadRaw(slug);
    if (!page) return null;
    const pattern = slug && content.spaceKeyOf(slug) === spaceKey ? ownSpace : anySpace;
    return pattern.test(page.raw.normalize("NFC")) ? { slug, title } : null;
  });
  return linking.filter((link): link is ImageLink => link !== null);
}

/**
 * Delete the image at `<space>/_assets/<rel>`, unless a page still links to
 * it: then nothing is deleted, and `linkedFrom` names the pages to take it off
 * first. Null when there is no such image. The caller commits the returned
 * `fsPath` once it is deleted.
 */
export async function deleteImage(content: Content, spaceKey: string, rel: string): Promise<ImageDeletion | null> {
  const fsPath = await content.resolveAsset(spaceKey, rel);
  if (!fsPath) return null;
  if (!isImageName(fsPath)) throw new Error(`_assets/${rel} is not an image (${IMAGE_FORMATS}).`);

  const inAssets = rel.split(/[\\/]/).filter(Boolean).join("/");
  const linkedFrom = await pagesLinkingTo(content, spaceKey, inAssets);
  if (!linkedFrom.length) await fs.rm(fsPath);
  return { path: inAssets, fsPath, linkedFrom };
}

/**
 * The deletions a server has just made, so that the gallery it redirects to
 * after one can say so. An image's absence proves nothing, since every name
 * that never existed is absent too, so the gallery claims a deletion only when
 * it finds it here: a typed or stale URL claims none. Each is claimed once and
 * forgotten after `ttlMs` unclaimed.
 */
export function makeRecentDeletions(ttlMs = 60_000, now: () => number = Date.now) {
  const made = new Map<string, number>();
  const key = (spaceKey: string, rel: string) => `${spaceKey}\0${rel}`;
  const prune = () => {
    const at = now();
    for (const [k, when] of made) if (at - when >= ttlMs) made.delete(k);
  };
  return {
    record(spaceKey: string, rel: string): void {
      prune();
      made.set(key(spaceKey, rel), now());
    },
    /** Whether this server just deleted `rel` from the space; true only once. */
    claim(spaceKey: string, rel: string): boolean {
      prune();
      return made.delete(key(spaceKey, rel));
    },
  };
}

/**
 * Save one upload into the space's `_assets`, under a name of its own. An
 * image already there is never replaced: a second `photo.png` becomes
 * `photo-2.png`. The caller commits the returned `fsPath`.
 */
export async function saveImage(
  content: Content,
  spaceKey: string,
  file: { name: string; type: string },
  bytes: Uint8Array
): Promise<SavedImage> {
  const root = assetsDir(content, spaceKey);
  if (!root || !(await isRealDir(path.dirname(root)))) {
    throw new Error(`There is no space named "${spaceKey}".`);
  }
  const fileName = imageFileName(file.name, file.type);
  if (!fileName) throw new Error(`${file.name} is not an image (${IMAGE_FORMATS}).`);

  await fs.mkdir(root, { recursive: true });
  // mkdir is satisfied by a link to a folder; the files must land in a real one.
  if (!(await isRealDir(root))) throw new Error("This space's _assets is not a folder Crescent can write to.");

  const ext = path.extname(fileName);
  const base = fileName.slice(0, -ext.length);
  for (let n = 1; n <= 1000; n += 1) {
    const candidate = n === 1 ? fileName : `${base}-${n}${ext}`;
    const fsPath = path.join(root, candidate);
    if ((await content.fileState(fsPath)) !== "missing") continue;
    try {
      // `wx` fails on anything already at the path, a link included, so a file
      // that appeared since the check above is never written through.
      await fs.writeFile(fsPath, bytes, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    return { path: candidate, fsPath };
  }
  throw new Error(`Too many images are named like ${fileName}; rename it and upload it again.`);
}
