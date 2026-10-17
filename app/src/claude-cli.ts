/**
 * Runs the person's own Claude Code non-interactively (`claude -p`) for the
 * viewer's chat: finds the program, checks it is new enough and signed in,
 * starts one turn of a conversation, and turns its stream-json output into a
 * few typed events.
 *
 * Each turn is its own process. The first turn names the session
 * (`--session-id`) and later turns `--resume` it, so a chat thread is one
 * Claude session that survives a server restart. The kb25 MCP server is the
 * only one attached (`--strict-mcp-config`), the only built-in tools are web
 * search and fetch, and `--setting-sources project` from an empty working
 * folder keeps the person's own plugins, hooks and settings out of it — while
 * still using whatever they signed in with, which `--bare` would not.
 *
 * The MCP config and the system prompt travel as files rather than arguments:
 * a Windows `claude.cmd` has to go through cmd.exe, which mangles JSON.
 */
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** `--permission-prompts` arrived in 2.1.259; older versions reject it. */
export const MIN_CLAUDE_VERSION = "2.1.259";

export type ClaudeStatus =
  | { state: "ok"; path: string; version: string }
  | { state: "missing" }
  | { state: "signed-out"; path: string; version: string }
  | { state: "too-old"; path: string; version: string; minimum: string }
  | { state: "broken"; path: string; detail: string };

/** One thing a turn reported, reduced to what the chat shows or records. */
export type ClaudeEvent =
  | { type: "init"; sessionId: string; model: string; mcpServers: { name: string; status: string }[] }
  /** A piece of the reply as it streams; the full text follows in `assistant`. */
  | { type: "text"; text: string }
  | { type: "assistant"; blocks: AssistantBlock[] }
  | { type: "tool_result"; toolUseId: string; isError: boolean; text: string }
  | { type: "retry"; attempt: number; maxRetries: number; error: string }
  | {
      type: "result";
      isError: boolean;
      subtype: string;
      text: string;
      sessionId: string;
      costUsd?: number;
    };

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/**
 * Where `claude` may be, in the order to try. A launcher-started server (the
 * app, the Start-menu shortcut) has a bare PATH, so the usual install folders
 * are listed after it. `KB25_CLAUDE_PATH`, when set, is the only candidate.
 */
export function claudeCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): string[] {
  if (env.KB25_CLAUDE_PATH) return [env.KB25_CLAUDE_PATH];
  const win = platform === "win32";
  const names = win ? ["claude.exe", "claude.cmd"] : ["claude"];
  const join = win ? path.win32.join : path.posix.join;
  const dirs = (env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean);
  dirs.push(join(home, ".local", "bin"), join(home, ".claude", "local"));
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
export async function findClaude(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const candidate of claudeCandidates(env)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there; try the next.
    }
  }
  if (env.KB25_CLAUDE_PATH || process.platform === "win32") return null;
  const shell = env.SHELL || "/bin/sh";
  const found = await runQuiet(shell, ["-lc", "command -v claude"], 5000);
  const line = found?.code === 0 ? found.stdout.trim().split("\n").pop() : undefined;
  return line && path.isAbsolute(line) ? line : null;
}

/** Pull `2.1.302` out of `claude --version`'s `2.1.302 (Claude Code)`. */
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
 * Whether `claude auth status` says someone is signed in. It exits 0 when
 * they are and 1 when not; the JSON's `loggedIn` decides when it parses.
 */
export function parseAuthStatus(code: number | null, stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { loggedIn?: unknown };
    if (typeof parsed.loggedIn === "boolean") return parsed.loggedIn;
  } catch {
    // Older versions print text; fall back to the exit code.
  }
  return code === 0;
}

/** Find `claude` and check that it is new enough and signed in. */
export async function checkClaude(env: NodeJS.ProcessEnv = process.env): Promise<ClaudeStatus> {
  const found = await findClaude(env);
  if (!found) return { state: "missing" };
  const versionRun = await runQuiet(found, ["--version"], 15000);
  const version = versionRun?.code === 0 ? parseVersion(versionRun.stdout) : null;
  if (!version) {
    return { state: "broken", path: found, detail: (versionRun?.stderr || "no version").trim().slice(0, 300) };
  }
  if (!versionAtLeast(version, MIN_CLAUDE_VERSION)) {
    return { state: "too-old", path: found, version, minimum: MIN_CLAUDE_VERSION };
  }
  const auth = await runQuiet(found, ["auth", "status"], 15000);
  if (!auth || !parseAuthStatus(auth.code, auth.stdout)) return { state: "signed-out", path: found, version };
  return { state: "ok", path: found, version };
}

export interface TurnFiles {
  /** JSON for `--mcp-config`: the kb25 server and nothing else. */
  mcpConfig: string;
  /** Text for `--append-system-prompt-file`. */
  systemPrompt: string;
}

/** The arguments for one turn. The prompt itself goes on stdin (`turnInput`). */
export function turnArgs(options: { sessionId: string; resume: boolean; files: TurnFiles }): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    options.resume ? "--resume" : "--session-id",
    options.sessionId,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    options.files.mcpConfig,
    "--tools",
    "WebSearch,WebFetch",
    "--allowedTools",
    "mcp__kb25,WebSearch,WebFetch",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--disable-slash-commands",
    "--append-system-prompt-file",
    options.files.systemPrompt,
  ];
}

/** The `--mcp-config` document attaching kb25, run as `command args…` with `env`. */
export function mcpConfig(command: string, args: string[], env: Record<string, string>): string {
  return `${JSON.stringify({ mcpServers: { kb25: { type: "stdio", command, args, env } } }, null, 2)}\n`;
}

/** The stdin of a turn: one stream-json user message. */
export function turnInput(text: string): string {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
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

type Json = Record<string, unknown>;

/**
 * The events in one line of stream-json output. Lines that are not JSON, and
 * kinds the chat has no use for (status pings, rate-limit notices, message
 * framing), yield nothing; so does anything a subagent said.
 */
export function parseLine(line: string): ClaudeEvent[] {
  let raw: Json;
  try {
    raw = JSON.parse(line) as Json;
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];
  if ("parent_tool_use_id" in raw && raw.parent_tool_use_id != null) return [];

  switch (raw.type) {
    case "system": {
      if (raw.subtype === "init") {
        const servers = Array.isArray(raw.mcp_servers) ? (raw.mcp_servers as Json[]) : [];
        return [
          {
            type: "init",
            sessionId: String(raw.session_id ?? ""),
            model: String(raw.model ?? ""),
            mcpServers: servers.map((s) => ({ name: String(s.name ?? ""), status: String(s.status ?? "") })),
          },
        ];
      }
      if (raw.subtype === "api_retry") {
        return [
          {
            type: "retry",
            attempt: Number(raw.attempt ?? 0),
            maxRetries: Number(raw.max_retries ?? 0),
            error: String(raw.error ?? "unknown"),
          },
        ];
      }
      return [];
    }
    case "stream_event": {
      const event = raw.event as Json | undefined;
      const delta = event?.delta as Json | undefined;
      if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
        return [{ type: "text", text: delta.text }];
      }
      return [];
    }
    case "assistant": {
      const blocks: AssistantBlock[] = [];
      for (const block of messageContent(raw)) {
        if (block.type === "text" && typeof block.text === "string") {
          blocks.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const input = block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {};
          blocks.push({ type: "tool_use", id: block.id, name: String(block.name ?? ""), input });
        }
      }
      return blocks.length > 0 ? [{ type: "assistant", blocks }] : [];
    }
    case "user": {
      const events: ClaudeEvent[] = [];
      for (const block of messageContent(raw)) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        events.push({
          type: "tool_result",
          toolUseId: block.tool_use_id,
          isError: block.is_error === true,
          text: resultText(block.content),
        });
      }
      return events;
    }
    case "result":
      return [
        {
          type: "result",
          isError: raw.is_error === true,
          subtype: String(raw.subtype ?? ""),
          text: typeof raw.result === "string" ? raw.result : "",
          sessionId: String(raw.session_id ?? ""),
          ...(typeof raw.total_cost_usd === "number" && { costUsd: raw.total_cost_usd }),
        },
      ];
    default:
      return [];
  }
}

function messageContent(raw: Json): Json[] {
  const message = raw.message as Json | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content.filter((b) => b && typeof b === "object") as Json[]) : [];
}

/** A tool result's text: a plain string, or the text blocks of a block list. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is Json => !!b && typeof b === "object" && (b as Json).type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");
}

export interface Turn {
  /** End the turn early. Claude keeps the conversation, so the next turn resumes it. */
  stop(): void;
  /** Settles when the process has exited. */
  done: Promise<{ code: number | null; stderr: string }>;
}

export type SpawnImpl = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface TurnOptions {
  claudePath: string;
  sessionId: string;
  resume: boolean;
  files: TurnFiles;
  /** The working folder: empty, so no project settings or CLAUDE.md come along. */
  cwd: string;
  text: string;
  onEvent: (event: ClaudeEvent) => void;
  spawnImpl?: SpawnImpl;
}

/** Start one turn: spawn `claude`, write the prompt, stream its events. */
export function startTurn(options: TurnOptions): Turn {
  const args = turnArgs(options);
  const child = spawnClaude(options.claudePath, args, { cwd: options.cwd }, options.spawnImpl ?? spawn);
  const splitter = lineSplitter((line) => {
    for (const event of parseLine(line)) options.onEvent(event);
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
  child.stdin?.end(turnInput(options.text));

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

/**
 * Spawn `claude`. A Windows `.cmd` shim (an npm install) only runs through a
 * shell, which joins the arguments with spaces, so quote any that need it.
 */
function spawnClaude(command: string, args: string[], options: SpawnOptions, spawnImpl: SpawnImpl): ChildProcess {
  const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const env = { ...process.env, ...options.env };
  if (!shim) return spawnImpl(command, args, { ...options, env, windowsHide: true });
  const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return spawnImpl([command, ...args].map(quote).join(" "), [], { ...options, env, shell: true, windowsHide: true });
}

/** Run a short command; its exit code and output, or null when it could not start or timed out. */
function runQuiet(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
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
