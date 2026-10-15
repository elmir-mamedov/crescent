/**
 * Pages an agent created that nobody has opened yet. The sidebar marks each one
 * with a dot until the reader visits it.
 *
 * Two processes share this state: the MCP server marks a page as it creates it,
 * and the web server clears the mark when the page is opened. So each mark is
 * its own empty file, named by the page's id, under `<KB_DIR>/.kb25/fresh/`:
 * adding or removing one file never rewrites what the other process wrote, as
 * a shared JSON list would. The folder sits beside the spaces rather than in
 * one, so no space's repo ever commits a mark, and its leading dot keeps space
 * discovery and sync from taking it for a space.
 *
 * Keyed by id rather than slug, so a page that is moved or renamed before
 * anyone opens it keeps its dot. A mark whose page was since deleted matches no
 * row and costs one empty file.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface FreshPages {
  /** Mark the page with this id as created and not yet opened. */
  mark(id: string): Promise<void>;
  /** Clear the mark, if there is one: the page has been opened. */
  clear(id: string): Promise<void>;
  /** The ids of every marked page. */
  ids(): Promise<Set<string>>;
}

/** Page ids are lowercase base36 (`newPageId`); anything else never names a file here. */
const ID = /^[a-z0-9]{1,64}$/;

export function makeFreshPages(kbDir: string): FreshPages {
  const dir = path.join(kbDir, ".kb25", "fresh");
  return {
    async mark(id) {
      if (!ID.test(id)) return;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, id), "");
    },
    async clear(id) {
      if (!ID.test(id)) return;
      await fs.rm(path.join(dir, id), { force: true });
    },
    async ids() {
      try {
        return new Set((await fs.readdir(dir)).filter((name) => ID.test(name)));
      } catch {
        return new Set();
      }
    },
  };
}
