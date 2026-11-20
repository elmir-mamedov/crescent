import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a program to its end and resolve with what it printed, or reject as
 * execFile does, with no console window on Windows.
 *
 * The server runs with no console of its own when crescent's window starts
 * it, so Windows gives every console program it runs (git, on most page
 * loads) a fresh console window, which flashes up and closes again. Hiding it
 * changes nothing on macOS or Linux. Run git and other programs through this,
 * not execFile, so none is left out.
 */
export function run(
  file: string,
  args: readonly string[],
  options: ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, { ...options, encoding: "utf8", windowsHide: true });
}
