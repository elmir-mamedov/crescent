import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The KB as it changes on disk, for the pages open in the viewer (feedback
 * issue #17). Pages are rendered on the server, so a page an agent wrote
 * through MCP, or one a pull brought in, stayed out of the open page and its
 * sidebar until the reader clicked something. The feed watches the KB folder
 * and hands each batch of changed pages to the open pages (`GET /_changes`),
 * which reload or offer to (CHANGES_SCRIPT in views.ts).
 *
 * Batches are numbered and the recent ones kept, so a page that was rendered,
 * hidden or disconnected at some point asks for what came after it rather than
 * missing it. Its place is a cursor, `<feed id>.<batch>`; the id changes with
 * every server, and a cursor from an earlier one replays nothing.
 */

/** One batch of changes as a page receives it. */
export interface ChangeBatch {
  cursor: string;
  /** The slugs that changed, or null when the feed cannot say which. */
  slugs: string[] | null;
}

export interface ChangeFeedOptions {
  /** Quiet time that ends a batch, so a save or a pull is one batch. */
  settleMs?: number;
  /** Longest a batch waits for the changes to stop. */
  maxWaitMs?: number;
  /** How long a write the viewer made itself keeps its paths out of the feed. */
  ownMs?: number;
  /** How many batches are kept for pages catching up. */
  keep?: number;
}

/**
 * The slug a path inside the KB names, or null when it names nothing a page
 * shows. Hidden folders are git's and the viewer's own (`.git`, the chat
 * threads in `.kb25`), and so are editors' swap files; anything that is not
 * Markdown is an asset, a label palette or a temporary file. A folder's
 * `index.md` is the folder.
 */
export function changedSlug(relPath: string): string | null {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((part) => part.startsWith(".") || part === "_assets")) return null;
  const last = parts[parts.length - 1];
  const ext = path.extname(last);
  if (ext && ext !== ".md") return null;
  if (ext) parts[parts.length - 1] = last.slice(0, -ext.length);
  if (parts.length > 1 && parts[parts.length - 1] === "index") parts.pop();
  return parts.join("/");
}

export class ChangeFeed {
  private readonly root: string;
  private readonly id = randomBytes(4).toString("hex");
  private readonly settleMs: number;
  private readonly maxWaitMs: number;
  private readonly ownMs: number;
  private readonly keep: number;
  private seq = 0;
  private log: { seq: number; slugs: string[] | null }[] = [];
  private pending = new Set<string>();
  private firstPendingAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private own = new Map<string, number>();
  private listeners = new Set<(batch: ChangeBatch) => void>();
  private watcher: fs.FSWatcher | null = null;

  constructor(root: string, options: ChangeFeedOptions = {}) {
    this.root = path.resolve(root);
    this.settleMs = options.settleMs ?? 200;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.ownMs = options.ownMs ?? 2000;
    this.keep = options.keep ?? 100;
  }

  /** Where the feed is now: a page rendered at this point asks for what comes after it. */
  get cursor(): string {
    return `${this.id}.${this.seq}`;
  }

  /**
   * Watch the KB folder. Without a recursive watch (a file system that has
   * none), the viewer works as before and pages show changes when opened.
   */
  start(): void {
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_event, name) => {
        if (name) this.saw(name.toString());
      });
      this.watcher.on("error", (err) => this.stopWatching(err));
    } catch (err) {
      this.stopWatching(err);
    }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  /**
   * Paths the viewer itself is writing. The page that made the write already
   * shows it, and reloading it would only flash it and close what the reader
   * had open, so they stay out of the next batch. A path covers the folder it
   * is in and everything inside it, since a move reports the folder.
   */
  ownWrite(fsPaths: readonly string[]): void {
    const now = Date.now();
    for (const fsPath of fsPaths) this.own.set(path.resolve(fsPath), now);
  }

  /** A path inside the KB, relative to it, changed. */
  saw(relPath: string): void {
    if (changedSlug(relPath) === null) return;
    if (!this.pending.size) this.firstPendingAt = Date.now();
    this.pending.add(path.resolve(this.root, relPath));
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(this.settleMs, this.firstPendingAt + this.maxWaitMs - Date.now());
    this.timer = setTimeout(() => this.flush(), Math.max(0, wait));
  }

  /** Called with every batch from now on; returns the call that stops it. */
  subscribe(listener: (batch: ChangeBatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The batches after `cursor`. A cursor from another server replays nothing:
   * what changed while no server was watching is unknown, and the page shows
   * what was there when it was rendered. One older than the batches kept gets a
   * single batch of unknown slugs, since something it shows may have changed.
   */
  since(cursor: string): ChangeBatch[] {
    const [id, seqText] = cursor.split(".");
    const seq = Number(seqText);
    if (id !== this.id || !Number.isInteger(seq) || seq >= this.seq) return [];
    const oldest = this.log[0]?.seq ?? this.seq + 1;
    if (seq < oldest - 1) return [{ cursor: this.cursor, slugs: null }];
    return this.log.filter((batch) => batch.seq > seq).map((batch) => this.batch(batch));
  }

  private flush(): void {
    this.timer = null;
    const now = Date.now();
    for (const [fsPath, at] of this.own) if (now - at > this.ownMs) this.own.delete(fsPath);
    const slugs = new Set<string>();
    for (const fsPath of this.pending) {
      if (this.isOwn(fsPath)) continue;
      const slug = changedSlug(path.relative(this.root, fsPath));
      if (slug !== null) slugs.add(slug);
    }
    this.pending.clear();
    if (!slugs.size) return;

    this.seq += 1;
    const entry = { seq: this.seq, slugs: [...slugs].sort() };
    this.log.push(entry);
    if (this.log.length > this.keep) this.log.shift();
    const batch = this.batch(entry);
    for (const listener of this.listeners) listener(batch);
  }

  private isOwn(fsPath: string): boolean {
    for (const written of this.own.keys()) {
      if (
        written === fsPath ||
        written.startsWith(fsPath + path.sep) ||
        fsPath.startsWith(written + path.sep)
      ) {
        return true;
      }
    }
    return false;
  }

  private batch(entry: { seq: number; slugs: string[] | null }): ChangeBatch {
    return { cursor: `${this.id}.${entry.seq}`, slugs: entry.slugs };
  }

  private stopWatching(err: unknown): void {
    this.watcher?.close();
    this.watcher = null;
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Open pages won't follow changes to the KB: ${reason}`);
  }
}
