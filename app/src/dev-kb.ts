/**
 * The development KB. A checkout's server opens a sample knowledge base, the
 * spaces in dev/seed/ that `npm run dev:reset` copies into place, and never
 * the folder where an installed Crescent on the same computer keeps someone's
 * pages: testing there would commit every trial edit to them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./env-file.js";
import { makeGit } from "./git.js";

/** The sample spaces, as they are copied into a fresh development KB. */
export const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dev", "seed");

/**
 * Left in a KB that resetDevKb made, the only kind it deletes. It sits under
 * `.kb25/`, where the viewer keeps its own state and which it never shows.
 */
const MARKER = path.join(".kb25", "dev-sample");

/**
 * The installed copy's folder (KB25_HOME), where install.sh and install.ps1
 * put it, or null on a system they don't install on.
 */
export function installedHome(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.KB25_HOME) return env.KB25_HOME;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "KB25");
  if (process.platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "KB25");
  return null;
}

/** The KB the installed copy on this computer opens, from its .env; null when there is none. */
export function installedKbDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const home = installedHome(env);
  if (!home) return null;
  const kbDir = readEnvFile(path.join(home, ".env")).KB_DIR;
  if (!kbDir) return null;
  // A leading ~ is the home folder, as the MCP server reads it.
  return path.resolve(kbDir === "~" || kbDir.startsWith("~/") ? path.join(os.homedir(), kbDir.slice(1)) : kbDir);
}

/**
 * Whether two paths are the same folder. Compared by identity, so neither a
 * symbolic link nor a difference in case (which macOS and Windows ignore)
 * hides a match; a path that doesn't exist matches only itself.
 */
export function sameDir(a: string, b: string): boolean {
  try {
    const [x, y] = [fs.statSync(a, { bigint: true }), fs.statSync(b, { bigint: true })];
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export interface ResetOptions {
  /** Make the KB only when kbDir is missing or empty, and leave any other alone. */
  ifMissing?: boolean;
  /** The installed copy's KB, which is never touched; looked up when not given. */
  installedKb?: string | null;
}

/**
 * Replace kbDir with a fresh copy of the sample spaces, each its own git repo
 * with one commit, as the viewer makes a space. Returns the spaces it made, or
 * null when `ifMissing` found a KB already there.
 *
 * It deletes only what it made itself: it refuses the installed copy's KB, and
 * any folder holding files without its marker.
 */
export async function resetDevKb(kbDir: string, options: ResetOptions = {}): Promise<string[] | null> {
  const entries = fs.existsSync(kbDir) ? fs.readdirSync(kbDir).filter((name) => name !== ".DS_Store") : [];
  if (options.ifMissing && entries.length > 0) return null;

  const installedKb = options.installedKb === undefined ? installedKbDir() : options.installedKb;
  if (installedKb && sameDir(installedKb, kbDir)) {
    throw new Error(`${kbDir} is where your installed Crescent keeps its pages, and dev:reset never deletes them.`);
  }
  if (entries.length > 0) {
    if (!fs.existsSync(path.join(kbDir, MARKER))) {
      throw new Error(
        `${kbDir} holds files that dev:reset didn't put there. Move them somewhere else, ` +
          "or set KB_DIR to another folder, and run it again."
      );
    }
    fs.rmSync(kbDir, { recursive: true, force: true });
  }

  fs.cpSync(SEED_DIR, kbDir, { recursive: true, filter: (source) => path.basename(source) !== ".DS_Store" });
  fs.mkdirSync(path.join(kbDir, ".kb25"), { recursive: true });
  fs.writeFileSync(
    path.join(kbDir, MARKER),
    "A sample KB made by `npm run dev:reset`, which may delete this folder and make it again.\n"
  );

  const git = makeGit(kbDir);
  const spaces = fs
    .readdirSync(kbDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[._]/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const space of spaces) {
    const files = filesUnder(path.join(kbDir, space));
    await git.initSpaceRepo(space);
    await git.commitFiles(files, `Add the sample ${space} space`);
  }
  return spaces;
}

/** Every file under dir, at any depth. */
function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}
