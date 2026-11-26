/**
 * The example space (feedback #49): a space of real pages, on quantum field
 * theory from the ground up, that shows a new person what crescent is for.
 * Its pages use what crescent can show: math, Mermaid diagrams, pictures, an
 * interactive widget, tables, a file to download, links by id and to a
 * section, labels, tags, notes and folders.
 *
 * It ships with the app, in examples/, and the first time crescent opens a
 * knowledge base with no spaces in it, it copies the space in, where it is
 * theirs to read, change or delete like any other. A marker under `.kb25/`
 * records that crescent has looked once, so deleting the space never brings
 * it back, and a knowledge base that already had spaces when crescent first
 * looked never gets one.
 */
import fs from "node:fs";
import path from "node:path";
import type { Git } from "./git.js";

/** The example space's key, in examples/ and in the knowledge base it is copied into. */
export const EXAMPLE_SPACE = "quantum-field-theory";

/** Where crescent keeps its own copy of the example space: examples/ beside src/ or server/. */
export function examplesRoot(appDir: string): string {
  return path.join(appDir, "examples");
}

/** Left in the knowledge base once crescent has offered the example space there. */
const MARKER = path.join(".kb25", "example-offered");

/** The folders in kbDir that are spaces: everything but `.kb25/` and the like. */
function spaceFolders(kbDir: string): string[] {
  if (!fs.existsSync(kbDir)) return [];
  return fs
    .readdirSync(kbDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[._]/.test(entry.name))
    .map((entry) => entry.name);
}

/** Every file under dir, at any depth. */
function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * Copy the example space into kbDir, the first time crescent opens a
 * knowledge base with no spaces. Returns the space key it added, or null
 * when it added none: crescent has looked here before, or the knowledge base
 * already had spaces, or the app has no example to copy. Either way it
 * leaves the marker, so it never looks again.
 *
 * The space is committed as one change, as a space made in crescent is; with
 * no git on the computer, the pages are copied all the same.
 */
export async function offerExampleSpace(
  kbDir: string,
  root: string,
  git: Pick<Git, "initSpaceRepo" | "commitFiles">
): Promise<string | null> {
  const marker = path.join(kbDir, MARKER);
  if (fs.existsSync(marker)) return null;

  const source = path.join(root, EXAMPLE_SPACE);
  let added: string | null = null;
  if (spaceFolders(kbDir).length === 0 && fs.existsSync(path.join(source, "index.md"))) {
    const target = path.join(kbDir, EXAMPLE_SPACE);
    fs.cpSync(source, target, { recursive: true, filter: (from) => path.basename(from) !== ".DS_Store" });
    // Listed before git init, which adds a .git/ of its own to the folder.
    const files = filesUnder(target);
    await git.initSpaceRepo(EXAMPLE_SPACE);
    await git.commitFiles(files, "Add the Quantum Field Theory example space");
    added = EXAMPLE_SPACE;
  }

  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, "crescent offered its example space here once, and won't again.\n");
  return added;
}
