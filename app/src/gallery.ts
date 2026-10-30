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
import type { Content } from "./content.js";

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
const IMAGE_FORMATS = "PNG, JPEG, GIF, WebP, AVIF or SVG";

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

export function isImageName(name: string): boolean {
  return Object.hasOwn(IMAGE_TYPES, path.extname(name).toLowerCase());
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
