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
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EngineId } from "./agent-cli.js";

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
      try {
        await fs.unlink(fileOf(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
