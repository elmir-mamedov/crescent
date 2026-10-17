/**
 * The viewer's chat threads, one JSON file each under
 * `<KB_DIR>/.kb25/chat/threads/`. They sit beside the spaces, like
 * `seen.json`, so no space's repo ever commits a conversation, and the
 * folder's leading dot keeps space discovery and sync from taking it for a
 * space.
 *
 * A thread's id is also its Claude session id: the first turn starts the
 * session under that id and every later turn resumes it, so Claude keeps the
 * conversation itself and these files only hold what the drawer shows.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** One page (or folder, or space) a turn changed, for the report card. */
export interface PageChange {
  kind: "created" | "updated" | "moved" | "renamed" | "archived" | "restored" | "deleted" | "noted";
  what: "page" | "folder" | "space";
  /** Stable page id, when the tool reported one; links resolve through it. */
  id?: string;
  /** Where it is now — or was, for a deletion. */
  slug: string;
  title: string;
}

export type ChatMessage =
  | { role: "user"; text: string; at: string; forcePages: boolean; slug?: string }
  | { role: "assistant"; text: string; at: string }
  | { role: "report"; changes: PageChange[]; at: string }
  | { role: "error"; text: string; at: string };

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /**
   * True once Claude has started the session, after which turns resume it.
   * Until then a turn must name it instead: resuming an unknown id fails.
   */
  started: boolean;
  messages: ChatMessage[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatStore {
  /** `<KB_DIR>/.kb25/chat`: the threads, and the files a turn runs with. */
  readonly dir: string;
  /** Every thread, most recently updated first. */
  list(): Promise<ThreadSummary[]>;
  get(id: string): Promise<ChatThread | null>;
  save(thread: ChatThread): Promise<void>;
  /** False when there was no such thread. */
  remove(id: string): Promise<boolean>;
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

export function makeChatStore(kbDir: string): ChatStore {
  const dir = path.join(kbDir, ".kb25", "chat");
  const threadsDir = path.join(dir, "threads");
  const fileOf = (id: string) => path.join(threadsDir, `${id}.json`);

  async function read(id: string): Promise<ChatThread | null> {
    if (!isThreadId(id)) return null;
    try {
      const data = JSON.parse(await fs.readFile(fileOf(id), "utf8")) as ChatThread;
      if (data?.id !== id || !Array.isArray(data.messages)) return null;
      return data;
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
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
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
      try {
        await fs.unlink(fileOf(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
