/**
 * The chat's Claude Code engine: the person's own `claude`, run
 * non-interactively (`claude -p`) one turn at a time.
 *
 * The first turn names the session (`--session-id`) and later turns
 * `--resume` it, so a chat thread is one Claude session that survives a
 * server restart. The kb25 MCP server is the only one attached
 * (`--strict-mcp-config`), the only built-in tools are web search and fetch,
 * and `--setting-sources project` from an empty working folder keeps the
 * person's own plugins, hooks and settings out of it — while still using
 * whatever they signed in with, which `--bare` would not. (`--safe-mode`
 * would also drop the `--mcp-config` server.)
 *
 * The MCP config and the system prompt travel as files rather than arguments:
 * a Windows `claude.cmd` has to go through cmd.exe, which mangles JSON.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  checkProgram,
  findProgram,
  isEffortName,
  isModelName,
  programCandidates,
  runQuiet,
  runToEnd,
  startProcessTurn,
  type AgentEvent,
  type AgentStatus,
  type AssistantBlock,
  type Engine,
  type ModelCatalog,
  type SpawnImpl,
  type Turn,
} from "./agent-cli.js";

/** `--permission-prompts` arrived in 2.1.259; older versions reject it. */
export const MIN_CLAUDE_VERSION = "2.1.259";

export function claudeCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home?: string
): string[] {
  return programCandidates("claude", "KB25_CLAUDE_PATH", env, platform, home);
}

export function findClaude(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return findProgram("claude", "KB25_CLAUDE_PATH", env);
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
export function checkClaude(env: NodeJS.ProcessEnv = process.env): Promise<AgentStatus> {
  return checkProgram({
    program: "claude",
    overrideVar: "KB25_CLAUDE_PATH",
    minimum: MIN_CLAUDE_VERSION,
    env,
    signedIn: async (found) => {
      const auth = await runQuiet(found, ["auth", "status"], 15000);
      return !!auth && parseAuthStatus(auth.code, auth.stdout);
    },
  });
}

export interface TurnFiles {
  /** JSON for `--mcp-config`: the kb25 server and nothing else. */
  mcpConfig: string;
  /** Text for `--append-system-prompt-file`. */
  systemPrompt: string;
}

/**
 * The arguments for one turn. The prompt itself goes on stdin (`turnInput`).
 * A model or effort level applies to this turn alone, so a resumed session
 * can change either. A resumed session otherwise keeps the model it last ran
 * on, so leaving the model to Claude Code there takes asking for `default`.
 */
export function turnArgs(options: {
  sessionId: string;
  resume: boolean;
  files: TurnFiles;
  model?: string;
  effort?: string;
}): string[] {
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
    ...(options.model ? ["--model", options.model] : options.resume ? ["--model", "default"] : []),
    ...(options.effort ? ["--effort", options.effort] : []),
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

type Json = Record<string, unknown>;

/**
 * Ask for the models the way the Agent SDK does: an `initialize` request on
 * stream-json stdin, which `claude -p` answers and then exits, with no turn
 * run and nothing sent to a model.
 */
export const MODELS_REQUEST = `${JSON.stringify({
  type: "control_request",
  request_id: "models",
  request: { subtype: "initialize" },
})}\n`;

/** The arguments for MODELS_REQUEST: a turn's isolation, minus what only a turn needs. */
export function modelsArgs(): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
}

/**
 * The catalog in the answer to MODELS_REQUEST (2.1.302): `default` is what
 * runs with no `--model`, and the model it resolves to names it. Effort
 * levels are listed only for models that take one.
 */
export function parseClaudeModels(stdout: string): ModelCatalog | null {
  for (const line of stdout.split("\n")) {
    let raw: Json;
    try {
      raw = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    if (raw?.type !== "control_response") continue;
    const listed = ((raw.response as Json | undefined)?.response as Json | undefined)?.models;
    if (!Array.isArray(listed)) continue;
    const entries = listed.filter((m): m is Json => {
      const value = m && typeof m === "object" ? (m as Json).value : undefined;
      return typeof value === "string" && isModelName(value);
    });
    const efforts = (m: Json) =>
      m.supportsEffort === true && Array.isArray(m.supportedEffortLevels)
        ? m.supportedEffortLevels.filter((e): e is string => typeof e === "string" && isEffortName(e))
        : [];
    const name = (m: Json) => (typeof m.displayName === "string" && m.displayName ? m.displayName : String(m.value));
    const fallback = entries.find((m) => m.value === "default");
    const others = entries.filter((m) => m !== fallback);
    const resolved = fallback && others.find((m) => m.resolvedModel === fallback.resolvedModel);
    return {
      default: { ...(resolved && { name: name(resolved) }), efforts: fallback ? efforts(fallback) : [] },
      models: others.map((m) => ({ id: m.value as string, name: name(m), efforts: efforts(m) })),
    };
  }
  return null;
}

/**
 * The events in one line of stream-json output. Lines that are not JSON, and
 * kinds the chat has no use for (status pings, rate-limit notices, message
 * framing), yield nothing; so does anything a subagent said.
 */
export function parseLine(line: string): AgentEvent[] {
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
      if (raw.subtype === "init") return [{ type: "init", sessionId: String(raw.session_id ?? "") }];
      if (raw.subtype === "api_retry") {
        return [
          {
            type: "notice",
            text: `Claude is busy; trying again (${Number(raw.attempt ?? 0)} of ${Number(raw.max_retries ?? 0)})…`,
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
      const events: AgentEvent[] = [];
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
    case "result": {
      const isError = raw.is_error === true;
      const text = typeof raw.result === "string" ? raw.result : "";
      return [{ type: "result", isError, text: isError && !text ? `Claude Code reported ${String(raw.subtype ?? "an error")}.` : text }];
    }
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

export interface TurnOptions {
  claudePath: string;
  sessionId: string;
  resume: boolean;
  files: TurnFiles;
  model?: string;
  effort?: string;
  /** The working folder: empty, so no project settings or CLAUDE.md come along. */
  cwd: string;
  text: string;
  onEvent: (event: AgentEvent) => void;
  spawnImpl?: SpawnImpl;
}

/** Start one turn: spawn `claude`, write the prompt, stream its events. */
export function startTurn(options: TurnOptions): Turn {
  return startProcessTurn({
    command: options.claudePath,
    args: turnArgs(options),
    cwd: options.cwd,
    input: turnInput(options.text),
    readLine: parseLine,
    onEvent: options.onEvent,
    spawnImpl: options.spawnImpl,
  });
}

export const claudeEngine: Engine = {
  id: "claude",
  name: "Claude Code",
  check: checkClaude,
  async models(claudePath, dir) {
    // The turns' own folder, so the same (absent) project settings apply.
    const cwd = path.join(dir, "claude");
    await fs.mkdir(cwd, { recursive: true });
    const run = await runToEnd(claudePath, modelsArgs(), { cwd, input: MODELS_REQUEST, timeoutMs: 15000 });
    return run?.code === 0 ? parseClaudeModels(run.stdout) : null;
  },
  async startTurn(options) {
    // Its own folder: Claude Code also reads AGENTS.md files, so it must not
    // share one with an engine that keeps its instructions in one.
    const cwd = path.join(options.dir, "claude");
    await fs.mkdir(cwd, { recursive: true });
    const files = { mcpConfig: path.join(options.dir, "mcp.json"), systemPrompt: path.join(options.dir, "prompt.md") };
    await fs.writeFile(files.mcpConfig, mcpConfig(options.mcp.command, options.mcp.args, options.mcp.env));
    await fs.writeFile(files.systemPrompt, options.prompt);
    return startTurn({
      claudePath: options.path,
      sessionId: options.session.id,
      resume: options.session.resume,
      files,
      model: options.model,
      effort: options.effort,
      cwd,
      text: options.text,
      onEvent: options.onEvent,
      spawnImpl: options.spawnImpl,
    });
  },
  lostSession: (stderr) => /no conversation found/i.test(stderr),
};
