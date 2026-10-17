/**
 * What the viewer's chat needs from an agent it runs as a program (Claude
 * Code's `claude -p`, Codex's `codex exec`): a way to find and check the
 * program, and to run one turn of a conversation as a child process whose
 * output becomes a few typed events. Each engine (claude-cli.ts,
 * codex-cli.ts) supplies its own arguments and its own reading of the output;
 * the process plumbing they share lives here.
 */
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EngineId = "claude" | "codex";

export type AgentStatus =
  | { state: "ok"; path: string; version: string }
  | { state: "missing" }
  | { state: "signed-out"; path: string; version: string }
  | { state: "too-old"; path: string; version: string; minimum: string }
  | { state: "broken"; path: string; detail: string };

/** One thing a turn reported, reduced to what the chat shows or records. */
export type AgentEvent =
  /** The session has started (or resumed) under this id. */
  | { type: "init"; sessionId: string }
  /** A piece of the reply as it arrives; the whole of it follows in `assistant`. */
  | { type: "text"; text: string }
  | { type: "assistant"; blocks: AssistantBlock[] }
  | { type: "tool_result"; toolUseId: string; isError: boolean; text: string }
  /** Something worth showing on the activity line that is not a tool call. */
  | { type: "notice"; text: string }
  | { type: "result"; isError: boolean; text: string };

/**
 * A tool call is named the way Claude Code names it — `mcp__kb25__<tool>`,
 * `WebSearch` — whichever engine made it, so the chat reads them one way.
 */
export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface Turn {
  /** End the turn early. The engine keeps the conversation, so a later turn resumes it. */
  stop(): void;
  /** Settles when the process has exited. */
  done: Promise<{ code: number | null; stderr: string }>;
}

export type SpawnImpl = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** How to start the kb25 MCP server: `command args…` with `env`. */
export interface McpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface EngineTurnOptions {
  /** The program, as `check` found it. */
  path: string;
  /** `<KB_DIR>/.kb25/chat`: the engine keeps its working folder and files under it. */
  dir: string;
  mcp: McpServerSpec;
  /** The chat's instructions, added to the engine's own. */
  prompt: string;
  /**
   * Resume session `id`, or start a new one. An engine that lets the caller
   * name a new session uses `id` for it; one that names its own ignores it and
   * reports the id it chose in the `init` event.
   */
  session: { id: string; resume: boolean };
  text: string;
  onEvent: (event: AgentEvent) => void;
  spawnImpl?: SpawnImpl;
}

export interface Engine {
  id: EngineId;
  /** What the drawer calls it. */
  name: string;
  check(env?: NodeJS.ProcessEnv): Promise<AgentStatus>;
  startTurn(options: EngineTurnOptions): Promise<Turn>;
  /** True when a resume failed because the engine no longer has the session. */
  lostSession(stderr: string): boolean;
}

/**
 * Where a program may be, in the order to try. A launcher-started server (the
 * app, the Start-menu shortcut) has a bare PATH, so the usual install folders
 * are listed after it. The override variable, when set, is the only candidate.
 */
export function programCandidates(
  program: string,
  overrideVar: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): string[] {
  const override = env[overrideVar];
  if (override) return [override];
  const win = platform === "win32";
  const names = win ? [`${program}.exe`, `${program}.cmd`] : [program];
  const join = win ? path.win32.join : path.posix.join;
  const dirs = (env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean);
  dirs.push(join(home, ".local", "bin"));
  if (program === "claude") dirs.push(join(home, ".claude", "local"));
  if (win) {
    if (env.APPDATA) dirs.push(join(env.APPDATA, "npm"));
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin");
    dirs.push(...nvmBins(home));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

/** `~/.nvm/versions/node/<v>/bin`, newest first: where `npm i -g` puts it under nvm. */
function nvmBins(home: string): string[] {
  const root = path.join(home, ".nvm", "versions", "node");
  try {
    return fs
      .readdirSync(root)
      .sort()
      .reverse()
      .map((version) => path.join(root, version, "bin"));
  } catch {
    return [];
  }
}

/** The first candidate that is a file, else (macOS/Linux) what a login shell finds. */
export async function findProgram(
  program: string,
  overrideVar: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  for (const candidate of programCandidates(program, overrideVar, env)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there; try the next.
    }
  }
  if (env[overrideVar] || process.platform === "win32") return null;
  const shell = env.SHELL || "/bin/sh";
  const found = await runQuiet(shell, ["-lc", `command -v ${program}`], 5000);
  const line = found?.code === 0 ? found.stdout.trim().split("\n").pop() : undefined;
  return line && path.isAbsolute(line) ? line : null;
}

/** Pull `2.1.302` out of `2.1.302 (Claude Code)` or `codex-cli 0.157.0`. */
export function parseVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

/** True when dotted version `a` is at least `b`. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Find a program and check it: `--version` must answer with a version at
 * least `minimum`, and `signedIn` (given the program's path) must say yes.
 */
export async function checkProgram(options: {
  program: string;
  overrideVar: string;
  minimum: string;
  signedIn: (path: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
}): Promise<AgentStatus> {
  const found = await findProgram(options.program, options.overrideVar, options.env);
  if (!found) return { state: "missing" };
  const versionRun = await runQuiet(found, ["--version"], 15000);
  const version = versionRun?.code === 0 ? parseVersion(versionRun.stdout) : null;
  if (!version) {
    return { state: "broken", path: found, detail: (versionRun?.stderr || "no version").trim().slice(0, 300) };
  }
  if (!versionAtLeast(version, options.minimum)) {
    return { state: "too-old", path: found, version, minimum: options.minimum };
  }
  if (!(await options.signedIn(found))) return { state: "signed-out", path: found, version };
  return { state: "ok", path: found, version };
}

/**
 * Feed it stdout chunks; it calls `onLine` with each complete line, holding a
 * partial one until the rest arrives. `end()` flushes a final unterminated line.
 */
export function lineSplitter(onLine: (line: string) => void): { push(chunk: string): void; end(): void } {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.trim()) onLine(line);
      }
    },
    end() {
      if (pending.trim()) onLine(pending.replace(/\r$/, ""));
      pending = "";
    },
  };
}

/**
 * Run one turn as a child process: write `input` to its stdin, hand each line
 * of its stdout to `readLine`, and pass on the events that come back.
 */
export function startProcessTurn(options: {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  readLine: (line: string) => AgentEvent[];
  onEvent: (event: AgentEvent) => void;
  spawnImpl?: SpawnImpl;
}): Turn {
  const child = spawnAgent(options.command, options.args, { cwd: options.cwd }, options.spawnImpl ?? spawn);
  const splitter = lineSplitter((line) => {
    for (const event of options.readLine(line)) options.onEvent(event);
  });
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => splitter.push(chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    // Only the tail matters for an error message; don't let it grow unbounded.
    stderr = (stderr + chunk).slice(-4000);
  });
  child.stdin?.on("error", () => {
    // The process may exit before reading its input (a bad flag, a crash);
    // its exit code and stderr report that, not this.
  });
  child.stdin?.end(options.input);

  const done = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on("error", (err) => {
      stderr += `\n${err.message}`;
    });
    child.on("close", (code) => {
      splitter.end();
      resolve({ code, stderr: stderr.trim() });
    });
  });

  let stopping = false;
  return {
    done,
    stop() {
      if (stopping || child.exitCode !== null) return;
      stopping = true;
      stopProcess(child);
    },
  };
}

/**
 * SIGINT ends a turn cleanly on macOS and Linux; give it ten seconds before
 * insisting. Windows has no SIGINT for a child, so end the process tree.
 */
function stopProcess(child: ChildProcess): void {
  if (process.platform === "win32") {
    if (child.pid) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
    return;
  }
  child.kill("SIGINT");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  }, 10_000);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}

/** A Windows `.cmd` shim (an npm install) only runs through a shell. */
function isShim(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

/**
 * Spawn the program. Through a shell, the arguments are joined with spaces,
 * so quote any that need it.
 */
function spawnAgent(command: string, args: string[], options: SpawnOptions, spawnImpl: SpawnImpl): ChildProcess {
  const env = { ...process.env, ...options.env };
  if (!isShim(command)) return spawnImpl(command, args, { ...options, env, windowsHide: true });
  const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return spawnImpl([command, ...args].map(quote).join(" "), [], { ...options, env, shell: true, windowsHide: true });
}

/** Run a short command; its exit code and output, or null when it could not start or timed out. */
export function runQuiet(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    const shim = isShim(command);
    const quote = (a: string) => (/[\s"]/.test(a) ? `"${a}"` : a);
    const file = shim ? [command, ...args].map(quote).join(" ") : command;
    execFile(
      file,
      shim ? [] : args,
      { timeout: timeoutMs, shell: shim, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return resolve(null);
        if (err && (err as { killed?: boolean }).killed) return resolve(null);
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}
