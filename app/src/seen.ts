/**
 * The pages a person has opened in the viewer. A page missing from the list is
 * new to them, whoever added it — an agent through MCP, someone in the browser,
 * a sync from another machine, a file written by hand — and the sidebar marks
 * it with a dot until they open it.
 *
 * The list starts from a baseline: whenever it is needed and none exists, every
 * page already in the KB is recorded as seen, so the first start after an
 * upgrade does not light up the whole tree, and neither does an unreadable
 * list. Only pages that appear after that are new.
 *
 * It is one JSON file of page ids, `<KB_DIR>/.kb25/seen.json`. It sits beside
 * the spaces rather than in one, so no space's repo ever commits it, and its
 * folder's leading dot keeps space discovery and sync from taking it for a
 * space. Ids are only ever added, and every write re-reads the file first, so
 * two viewers on one KB keep each other's visits. Keyed by id, so a page that
 * is moved or renamed before it is opened keeps its dot.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface SeenPages {
  /** Every page id that has been opened, or was already there when the list began. */
  ids(): Promise<ReadonlySet<string>>;
  /** Record that the page with this id has been opened. */
  add(id: string): Promise<void>;
}

/** `baseline` lists the ids of every page in the KB right now. */
export function makeSeenPages(kbDir: string, baseline: () => Promise<Iterable<string>>): SeenPages {
  const file = path.join(kbDir, ".kb25", "seen.json");
  // Writes from this process run one at a time, so none is lost to another's
  // read; the re-read before each write covers other processes.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function read(): Promise<Set<string> | null> {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      if (!Array.isArray(data?.ids)) return null;
      return new Set(data.ids.filter((id: unknown): id is string => typeof id === "string"));
    } catch {
      return null;
    }
  }

  async function write(ids: Set<string>): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // A reader must never catch the file half-written, or it would start over
    // from a baseline and forget what is new: write aside, then swap it in.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ ids: [...ids].sort() }) + "\n");
    await fs.rename(tmp, file);
  }

  /** The list on disk, begun from the baseline if there is none. */
  async function current(): Promise<Set<string>> {
    const onDisk = await read();
    if (onDisk) return onDisk;
    const ids = new Set(await baseline());
    await write(ids);
    return ids;
  }

  return {
    async ids() {
      return (await read()) ?? serial(current);
    },
    add(id) {
      return serial(async () => {
        const ids = await current();
        if (ids.has(id)) return;
        ids.add(id);
        await write(ids);
      });
    },
  };
}
