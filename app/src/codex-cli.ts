/**
 * The chat's Codex engine: the person's own `codex`, run non-interactively
 * (`codex exec --json`) one turn at a time.
 *
 * Codex names a session itself and reports the id when the thread starts;
 * later turns `resume` it. The kb25 MCP server is attached through `-c`
 * overrides, `--ignore-user-config` keeps the person's own config (and its MCP
 * servers) out while their sign-in still works, and the shell, apps, browser
 * and computer tools are switched off, leaving kb25 and web search; the
 * read-only sandbox backs that up. The chat's instructions go in an AGENTS.md
 * in Codex's own working folder, which Codex reads when a thread starts and
 * keeps with it.
 *
 * Codex sends each message whole rather than streaming it, and says things
 * on its way ("I'll look the space up first") as messages too. Those are
 * only known to be asides once a tool call follows them, so a message is
 * held until then: followed by a tool call, it goes to the activity line;
 * left when the turn ends, it is the reply.
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
  type Engine,
  type McpServerSpec,
  type ModelCatalog,
  type ModelOption,
} from "./agent-cli.js";

/** The oldest version the chat has been run against. */
export const MIN_CODEX_VERSION = "0.157.0";

/**
 * Codex features that would hand the chat tools beyond kb25 and web search.
 * Every name must exist in the minimum version: an unknown one is an error.
 */
export const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "multi_agent",
];

export function codexCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home?: string
): string[] {
  return programCandidates("codex", "KB25_CODEX_PATH", env, platform, home);
}

export function findCodex(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return findProgram("codex", "KB25_CODEX_PATH", env);
}

/** Find `codex` and check that it is new enough and signed in (`codex login status` exits 0). */
export function checkCodex(env: NodeJS.ProcessEnv = process.env): Promise<AgentStatus> {
  return checkProgram({
    program: "codex",
    overrideVar: "KB25_CODEX_PATH",
    minimum: MIN_CODEX_VERSION,
    env,
    signedIn: async (found) => (await runQuiet(found, ["login", "status"], 15000))?.code === 0,
  });
}

/**
 * A TOML string for a `-c` value. A literal string (single quotes) needs no
 * escaping and survives cmd.exe, which a Windows `codex.cmd` goes through;
 * text with a single quote or a line break falls back to a basic string.
 */
export function tomlString(value: string): string {
  return /['\r\n]/.test(value) ? JSON.stringify(value) : `'${value}'`;
}

/**
 * The arguments for one turn. The prompt itself goes on stdin. A model or
 * effort level applies to this turn alone; resuming a session with another
 * model works, though Codex says it may not do as well.
 */
export function codexArgs(options: {
  sessionId: string;
  resume: boolean;
  mcp: McpServerSpec;
  model?: string;
  effort?: string;
}): string[] {
  const { mcp } = options;
  const env = Object.entries(mcp.env)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(", ");
  const args = ["exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "--sandbox", "read-only", "--color", "never"];
  for (const feature of DISABLED_FEATURES) args.push("--disable", feature);
  args.push(
    "-c",
    `web_search=${tomlString("live")}`,
    "-c",
    `mcp_servers.kb25.command=${tomlString(mcp.command)}`,
    "-c",
    `mcp_servers.kb25.args=[${mcp.args.map(tomlString).join(", ")}]`,
    "-c",
    `mcp_servers.kb25.env={${env}}`,
    // A tool that is not read-only asks first, and exec has nobody to ask:
    // without this every write is refused. The person asked for the chat to
    // write; space instructions and git history are its safeguards.
    "-c",
    `mcp_servers.kb25.default_tools_approval_mode=${tomlString("approve")}`
  );
  if (options.model) args.push("-c", `model=${tomlString(options.model)}`);
  if (options.effort) args.push("-c", `model_reasoning_effort=${tomlString(options.effort)}`);
  if (options.resume) args.push("resume", options.sessionId);
  args.push("-");
  return args;
}

type Json = Record<string, unknown>;

/**
 * The catalog `codex debug models` prints (0.157.0): the models Codex lists in
 * its own picker, in its order. The catalog does not say which one runs when
 * none is named, so the default offers only the effort levels every model takes.
 */
export function parseCodexModels(stdout: string): ModelCatalog | null {
  let raw: Json;
  try {
    raw = JSON.parse(stdout) as Json;
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.models)) return null;
  const models: ModelOption[] = (raw.models as unknown[])
    .filter((m): m is Json => {
      const slug = m && typeof m === "object" ? (m as Json).slug : undefined;
      return (m as Json)?.visibility === "list" && typeof slug === "string" && isModelName(slug);
    })
    .sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0))
    .map((m) => ({
      id: m.slug as string,
      name: typeof m.display_name === "string" && m.display_name ? m.display_name : (m.slug as string),
      efforts: Array.isArray(m.supported_reasoning_levels)
        ? m.supported_reasoning_levels
            .map((level) => (level && typeof level === "object" ? (level as Json).effort : level))
            .filter((effort): effort is string => typeof effort === "string" && isEffortName(effort))
        : [],
    }));
  const shared = (models[0]?.efforts ?? []).filter((effort) => models.every((m) => m.efforts.includes(effort)));
  return { default: { efforts: shared }, models };
}

/**
 * A reader for one turn's `--json` output: each line in, the events it means
 * out. Stateful, because a message is held until the turn shows whether it
 * was an aside or the reply; use a new one per turn.
 */
export function codexReader(): (line: string) => AgentEvent[] {
  let held: string[] = [];
  const started = new Set<string>();
  const asides = (): AgentEvent[] => {
    const events = held.map((text): AgentEvent => ({ type: "notice", text: text.replace(/\s+/g, " ").trim() }));
    held = [];
    return events;
  };
  const reply = (): AgentEvent[] => {
    const text = held.join("\n\n").trim();
    held = [];
    return text ? [{ type: "text", text }, { type: "assistant", blocks: [{ type: "text", text }] }] : [];
  };
  const toolUse = (item: Json): AgentEvent[] => {
    const id = String(item.id ?? "");
    if (!id || started.has(id)) return [];
    started.add(id);
    const name =
      item.type === "web_search" ? "WebSearch" : `mcp__${String(item.server ?? "")}__${String(item.tool ?? "")}`;
    const input =
      item.type === "web_search"
        ? { query: typeof item.query === "string" ? item.query : "" }
        : item.arguments && typeof item.arguments === "object"
          ? (item.arguments as Record<string, unknown>)
          : {};
    return [...asides(), { type: "assistant", blocks: [{ type: "tool_use", id, name, input }] }];
  };

  return (line) => {
    let raw: Json;
    try {
      raw = JSON.parse(line) as Json;
    } catch {
      return [];
    }
    if (!raw || typeof raw !== "object") return [];
    const item = (raw.item && typeof raw.item === "object" ? raw.item : {}) as Json;
    switch (raw.type) {
      case "thread.started":
        return typeof raw.thread_id === "string" ? [{ type: "init", sessionId: raw.thread_id }] : [];
      case "item.started":
        return item.type === "mcp_tool_call" || item.type === "web_search" ? toolUse(item) : [];
      case "item.completed":
        if (item.type === "agent_message" && typeof item.text === "string") {
          held.push(item.text);
          return [];
        }
        if (item.type === "web_search") return toolUse(item);
        if (item.type === "mcp_tool_call") {
          const result = (item.result && typeof item.result === "object" ? item.result : {}) as Json;
          const error = (item.error && typeof item.error === "object" ? item.error : null) as Json | null;
          const text = contentText(result.content) || (error ? String(error.message ?? "") : "");
          const isError = item.status === "failed" || !!error || result.isError === true || result.is_error === true;
          return [...toolUse(item), { type: "tool_result", toolUseId: String(item.id ?? ""), isError, text }];
        }
        if (item.type === "error" && typeof item.message === "string") return [{ type: "notice", text: item.message }];
        return [];
      case "turn.completed":
        return [...reply(), { type: "result", isError: false, text: "" }];
      case "turn.failed": {
        const error = (raw.error && typeof raw.error === "object" ? raw.error : {}) as Json;
        return [
          ...reply(),
          { type: "result", isError: true, text: typeof error.message === "string" ? error.message : "Codex reported an error." },
        ];
      }
      case "error":
        // Reconnecting and the like; a fatal one is followed by turn.failed.
        return typeof raw.message === "string" ? [{ type: "notice", text: `Codex: ${raw.message}` }] : [];
      default:
        return [];
    }
  };
}

/** The text blocks of an MCP tool result's content. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is Json => !!b && typeof b === "object" && (b as Json).type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");
}

export const codexEngine: Engine = {
  id: "codex",
  name: "Codex",
  check: checkCodex,
  async models(codexPath, dir) {
    // The turns' own folder, so no project's .codex config applies.
    const cwd = path.join(dir, "codex");
    await fs.mkdir(cwd, { recursive: true });
    const run = await runToEnd(codexPath, ["debug", "models"], { cwd, timeoutMs: 15000 });
    return run?.code === 0 ? parseCodexModels(run.stdout) : null;
  },
  async startTurn(options) {
    // Its own folder, holding the instructions as AGENTS.md: Claude Code also
    // reads AGENTS.md files, so it must never run here.
    const cwd = path.join(options.dir, "codex");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(path.join(cwd, "AGENTS.md"), options.prompt);
    return startProcessTurn({
      command: options.path,
      args: codexArgs({
        sessionId: options.session.id,
        resume: options.session.resume,
        mcp: options.mcp,
        model: options.model,
        effort: options.effort,
      }),
      cwd,
      input: options.text,
      readLine: codexReader(),
      onEvent: options.onEvent,
      spawnImpl: options.spawnImpl,
    });
  },
  lostSession: (stderr) => /no rollout found/i.test(stderr),
};
