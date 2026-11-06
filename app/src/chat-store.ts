/**
 * The viewer's chat threads, one JSON file each under
 * `<KB_DIR>/.kb25/chat/threads/`. They sit beside the spaces, like
 * `seen.json`, so no space's repo ever commits a conversation, and the
 * folder's leading dot keeps space discovery and sync from taking it for a
 * space.
 *
 * A thread runs on one engine, Claude Code or Codex, for its whole life; the
 * engine keeps the conversation itself under its own session id, which every
 * later turn resumes, so these files only hold what the drawer shows.
 *
 * The images a person attaches to a message are kept with its thread, under
 * `images/<id>/`, and go when it goes. They are not in any space: one reaches
 * the KB only when the agent adds it to a page's space with kb_add_image.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { imageFileName, isImageName } from "./gallery.js";
import type { EngineId } from "./agent-cli.js";

/**
 * One page (or folder, or space) a turn changed, or one image it added to or
 * deleted from a space's `_assets`, for the report card.
 */
export interface PageChange {
  kind: "created" | "updated" | "moved" | "renamed" | "archived" | "restored" | "deleted" | "noted" | "added";
  what: "page" | "folder" | "space" | "image";
  /** Stable page id, when the tool reported one; links resolve through it. */
  id?: string;
  /**
   * Where it is now — or was, for a deletion. An image's is its path in the
   * KB, `<space>/_assets/plot.png`.
   */
  slug: string;
  title: string;
}

export type ChatMessage =
  /** `images` names the images attached to it, as {@link ChatStore.saveImages} saved them. */
  | { role: "user"; text: string; at: string; forcePages: boolean; slug?: string; images?: string[] }
  | { role: "assistant"; text: string; at: string }
  | { role: "report"; changes: PageChange[]; at: string }
  | { role: "error"; text: string; at: string };

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  engine: EngineId;
  /**
   * The engine's id for the conversation, once it has started one; later
   * turns resume it. Claude Code takes the thread's id for it, Codex picks
   * its own.
   */
  sessionId?: string;
  messages: ChatMessage[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  engine: EngineId;
}

/** An image attached to a message, as it arrives. */
export interface IncomingImage {
  name: string;
  type: string;
  bytes: Uint8Array;
  /** The copy shown to the model: a JPEG the browser made from it. Absent when it could not. */
  view?: Uint8Array;
}

export interface ChatStore {
  /** `<KB_DIR>/.kb25/chat`: the threads, and the files a turn runs with. */
  readonly dir: string;
  /** Every thread, most recently updated first. */
  list(): Promise<ThreadSummary[]>;
  get(id: string): Promise<ChatThread | null>;
  save(thread: ChatThread): Promise<void>;
  /** False when there was no such thread. Its images go with it. */
  remove(id: string): Promise<boolean>;
  /**
   * Save a message's images with thread `id`, each under a clean name of its
   * own (the gallery's: `Screenshot 1.PNG` becomes `screenshot-1.png`, and a
   * second one `screenshot-1-2.png`), and the model's copy of each beside it.
   * The names, in order.
   */
  saveImages(id: string, images: readonly IncomingImage[]): Promise<string[]>;
  /** Where a thread's image is, or null when it has no image by that name. */
  imageFile(id: string, name: string): Promise<string | null>;
  /** Where the model's copy of a thread's image is, or null when there is none. */
  imageView(id: string, name: string): Promise<string | null>;
}

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A thread id is a lowercase UUID; that it is one is also the guard against paths. */
export function isThreadId(id: string): boolean {
  return THREAD_ID.test(id);
}

/** A thread's title: the first line of its first message, cut to fit a list row. */
export function threadTitle(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return "New chat";
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/** A name {@link ChatStore.saveImages} gives, which is also the guard against paths. */
const IMAGE_NAME = /^[a-z0-9][a-z0-9-]*\.[a-z]+$/;

export function makeChatStore(kbDir: string): ChatStore {
  const dir = path.join(kbDir, ".kb25", "chat");
  const threadsDir = path.join(dir, "threads");
  const fileOf = (id: string) => path.join(threadsDir, `${id}.json`);
  const imagesOf = (id: string) => path.join(dir, "images", id);
  const viewOf = (id: string, name: string) => path.join(imagesOf(id), "view", `${name}.jpg`);

  /** `fsPath` when it is a plain file, never one reached through a link. */
  async function plainFile(fsPath: string): Promise<string | null> {
    try {
      return (await fs.lstat(fsPath)).isFile() ? fsPath : null;
    } catch {
      return null;
    }
  }
  const imageName = (id: string, name: string) => isThreadId(id) && IMAGE_NAME.test(name) && isImageName(name);

  async function read(id: string): Promise<ChatThread | null> {
    if (!isThreadId(id)) return null;
    try {
      const data = JSON.parse(await fs.readFile(fileOf(id), "utf8")) as ChatThread & { started?: boolean };
      if (data?.id !== id || !Array.isArray(data.messages)) return null;
      // Threads from before Codex: Claude's, with its session under the
      // thread's own id once `started`.
      const { started, ...thread } = data;
      return {
        ...thread,
        engine: thread.engine === "codex" ? "codex" : "claude",
        ...(!thread.sessionId && started && { sessionId: id }),
      };
    } catch {
      return null;
    }
  }

  return {
    dir,
    async list() {
      let names: string[];
      try {
        names = await fs.readdir(threadsDir);
      } catch {
        return [];
      }
      const threads = await Promise.all(
        names.filter((name) => name.endsWith(".json")).map((name) => read(name.slice(0, -".json".length)))
      );
      return threads
        .filter((thread): thread is ChatThread => thread !== null)
        .map(({ id, title, updatedAt, engine }) => ({ id, title, updatedAt, engine }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get: read,
    async save(thread) {
      if (!isThreadId(thread.id)) throw new Error(`Not a thread id: ${thread.id}`);
      await fs.mkdir(threadsDir, { recursive: true });
      // Readers (the drawer, a second tab) must never see half a file.
      const file = fileOf(thread.id);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(thread, null, 2)}\n`);
      await fs.rename(tmp, file);
    },
    async remove(id) {
      if (!isThreadId(id)) return false;
      await fs.rm(imagesOf(id), { recursive: true, force: true });
      try {
        await fs.unlink(fileOf(id));
        return true;
      } catch {
        return false;
      }
    },
    async saveImages(id, images) {
      if (!isThreadId(id)) throw new Error(`Not a thread id: ${id}`);
      const folder = imagesOf(id);
      await fs.mkdir(path.join(folder, "view"), { recursive: true });
      const names: string[] = [];
      for (const image of images) {
        const fileName = imageFileName(image.name, image.type);
        if (!fileName) throw new Error(`${image.name} is not an image.`);
        const ext = path.extname(fileName);
        const base = fileName.slice(0, -ext.length);
        let saved: string | null = null;
        for (let n = 1; n <= 1000 && !saved; n += 1) {
          const candidate = n === 1 ? fileName : `${base}-${n}${ext}`;
          try {
            // `wx`: never over an image already there, or through a link.
            await fs.writeFile(path.join(folder, candidate), image.bytes, { flag: "wx" });
            saved = candidate;
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
          }
        }
        if (!saved) throw new Error(`Too many images are named like ${fileName}.`);
        if (image.view) await fs.writeFile(viewOf(id, saved), image.view, { flag: "wx" });
        names.push(saved);
      }
      return names;
    },
    async imageFile(id, name) {
      return imageName(id, name) ? plainFile(path.join(imagesOf(id), name)) : null;
    },
    async imageView(id, name) {
      return imageName(id, name) ? plainFile(viewOf(id, name)) : null;
    },
  };
}
