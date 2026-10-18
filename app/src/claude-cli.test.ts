import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./agent-cli.js";
import {
  claudeCandidates,
  claudeEngine,
  findClaude,
  mcpConfig,
  modelsArgs,
  MODELS_REQUEST,
  parseAuthStatus,
  parseClaudeModels,
  parseLine,
  startTurn,
  turnArgs,
  turnInput,
} from "./claude-cli.js";
import { makeTempKb } from "./test-helpers.js";

const FILES = { mcpConfig: "/kb/.kb25/chat/mcp.json", systemPrompt: "/kb/.kb25/chat/prompt.md" };

// Lines as `claude -p --output-format stream-json --verbose --include-partial-messages`
// printed them (2.1.302), trimmed to the fields that matter.
const INIT = JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "s-1",
  model: "claude-opus-5-5",
  mcp_servers: [{ name: "kb25", status: "connected", source: "dynamic" }],
  tools: ["WebSearch", "mcp__kb25__kb_list_spaces"],
});
const TOOL_USE = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_1", name: "mcp__kb25__kb_list_spaces", input: {} }],
  },
  parent_tool_use_id: null,
  session_id: "s-1",
});
const TOOL_RESULT = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ tool_use_id: "toolu_1", type: "tool_result", content: [{ type: "text", text: '{"spaces":[]}' }] }],
  },
  parent_tool_use_id: null,
  session_id: "s-1",
});
const DELTA = JSON.stringify({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "demo" } },
  parent_tool_use_id: null,
  session_id: "s-1",
});
const RESULT = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "demo",
  session_id: "s-1",
  total_cost_usd: 0.0174,
});

test("KB25_CLAUDE_PATH, when set, is the only place looked", () => {
  assert.deepEqual(claudeCandidates({ KB25_CLAUDE_PATH: "/opt/claude", PATH: "/usr/bin" }, "darwin", "/Users/a"), [
    "/opt/claude",
  ]);
});

test("PATH comes first, then the folders installers use, which a launcher's bare PATH lacks", () => {
  const found = claudeCandidates({ PATH: "/usr/bin:/bin" }, "darwin", "/Users/a");
  assert.deepEqual(found.slice(0, 6), [
    "/usr/bin/claude",
    "/bin/claude",
    "/Users/a/.local/bin/claude",
    "/Users/a/.claude/local/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]);
});

test("on Windows both the native exe and npm's cmd shim are candidates", () => {
  const found = claudeCandidates({ Path: "C:\\bin", APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32", "C:\\Users\\a");
  assert.deepEqual(found, [
    "C:\\bin\\claude.exe",
    "C:\\bin\\claude.cmd",
    "C:\\Users\\a\\.local\\bin\\claude.exe",
    "C:\\Users\\a\\.local\\bin\\claude.cmd",
    "C:\\Users\\a\\.claude\\local\\claude.exe",
    "C:\\Users\\a\\.claude\\local\\claude.cmd",
    "C:\\Users\\a\\AppData\\Roaming\\npm\\claude.exe",
    "C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd",
  ]);
});

test("findClaude takes the override when it exists and reports nothing when it does not", async () => {
  const kb = await makeTempKb();
  try {
    const fake = path.join(kb.dir, "claude");
    await fs.writeFile(fake, "");
    assert.equal(await findClaude({ KB25_CLAUDE_PATH: fake }), fake);
    assert.equal(await findClaude({ KB25_CLAUDE_PATH: path.join(kb.dir, "nope") }), null);
  } finally {
    await kb.cleanup();
  }
});

test("auth status reads loggedIn, falling back to the exit code", () => {
  assert.equal(parseAuthStatus(0, '{"loggedIn": true, "authMethod": "claude.ai"}'), true);
  assert.equal(parseAuthStatus(1, '{"loggedIn": false, "authMethod": "none"}'), false);
  assert.equal(parseAuthStatus(0, "Logged in"), true);
  assert.equal(parseAuthStatus(1, "Not logged in"), false);
});

test("the first turn names the session and later turns resume it", () => {
  const first = turnArgs({ sessionId: "abc", resume: false, files: FILES });
  const later = turnArgs({ sessionId: "abc", resume: true, files: FILES });
  assert.equal(first[first.indexOf("--session-id") + 1], "abc");
  assert.equal(first.includes("--resume"), false);
  assert.equal(later[later.indexOf("--resume") + 1], "abc");
  assert.equal(later.includes("--session-id"), false);
});

test("a turn gets kb25 alone, web tools only, and no prompts or person's settings", () => {
  const args = turnArgs({ sessionId: "abc", resume: false, files: FILES });
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(value("--mcp-config"), FILES.mcpConfig);
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(value("--tools"), "WebSearch,WebFetch");
  assert.equal(value("--allowedTools"), "mcp__kb25,WebSearch,WebFetch");
  assert.equal(value("--permission-mode"), "dontAsk");
  assert.equal(value("--permission-prompts"), "none");
  assert.equal(value("--setting-sources"), "project");
  assert.equal(value("--append-system-prompt-file"), FILES.systemPrompt);
  // --safe-mode would also drop the --mcp-config server, and --bare the sign-in.
  assert.equal(args.includes("--safe-mode"), false);
  assert.equal(args.includes("--bare"), false);
});

test("a model and effort level are passed only when chosen", () => {
  const plain = turnArgs({ sessionId: "abc", resume: true, files: FILES });
  assert.equal(plain.includes("--model"), false);
  assert.equal(plain.includes("--effort"), false);
  const chosen = turnArgs({ sessionId: "abc", resume: true, files: FILES, model: "sonnet[1m]", effort: "xhigh" });
  assert.equal(chosen[chosen.indexOf("--model") + 1], "sonnet[1m]");
  assert.equal(chosen[chosen.indexOf("--effort") + 1], "xhigh");
});

// The answer to MODELS_REQUEST as 2.1.302 gave it, trimmed to a few models and fields.
const ALL_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MODELS_RESPONSE = JSON.stringify({
  type: "control_response",
  response: {
    subtype: "success",
    request_id: "models",
    response: {
      models: [
        {
          value: "default",
          resolvedModel: "claude-opus-5-5",
          displayName: "Default (recommended)",
          description: "Opus 5.5 · Best for everyday, complex tasks",
          supportsEffort: true,
          supportedEffortLevels: ALL_EFFORTS,
        },
        { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", supportsEffort: true, supportedEffortLevels: ALL_EFFORTS },
        { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable 5.1", supportsEffort: true, supportedEffortLevels: ALL_EFFORTS },
        { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", supportsThinkingOff: true },
      ],
      claude_code_version: "2.1.302",
    },
  },
});

test("the model list names the default by the model it runs, and only lists efforts a model takes", () => {
  assert.deepEqual(parseClaudeModels(`not json\n${MODELS_RESPONSE}\n`), {
    default: { name: "Opus 5.5", efforts: ALL_EFFORTS },
    models: [
      { id: "opus", name: "Opus 5.5", efforts: ALL_EFFORTS },
      { id: "fable", name: "Fable 5.1", efforts: ALL_EFFORTS },
      { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", efforts: [] },
    ],
  });
  assert.equal(parseClaudeModels(RESULT), null);
  assert.equal(parseClaudeModels(""), null);
});

test("the models are asked for with a turn's isolation and no turn", () => {
  const args = modelsArgs();
  assert.equal(args[args.indexOf("--setting-sources") + 1], "project");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args.includes("--mcp-config"), false);
  assert.deepEqual(JSON.parse(MODELS_REQUEST), { type: "control_request", request_id: "models", request: { subtype: "initialize" } });
});

test("the MCP config attaches one stdio server named kb25", () => {
  const parsed = JSON.parse(mcpConfig("/usr/bin/node", ["mcp.mjs"], { KB_DIR: "/kb", KB25_COMMIT_VIA: "chat" }));
  assert.deepEqual(parsed, {
    mcpServers: {
      kb25: { type: "stdio", command: "/usr/bin/node", args: ["mcp.mjs"], env: { KB_DIR: "/kb", KB25_COMMIT_VIA: "chat" } },
    },
  });
});

test("the prompt goes in as one stream-json user message", () => {
  const line = turnInput('say "hi"\nplease');
  assert.ok(line.endsWith("\n"));
  assert.deepEqual(JSON.parse(line), { type: "user", message: { role: "user", content: 'say "hi"\nplease' } });
});

test("stream-json lines become init, text, tool and result events", () => {
  assert.deepEqual(parseLine(INIT), [
    { type: "init", sessionId: "s-1" },
  ]);
  assert.deepEqual(parseLine(DELTA), [{ type: "text", text: "demo" }]);
  assert.deepEqual(parseLine(TOOL_USE), [
    { type: "assistant", blocks: [{ type: "tool_use", id: "toolu_1", name: "mcp__kb25__kb_list_spaces", input: {} }] },
  ]);
  assert.deepEqual(parseLine(TOOL_RESULT), [
    { type: "tool_result", toolUseId: "toolu_1", isError: false, text: '{"spaces":[]}' },
  ]);
  assert.deepEqual(parseLine(RESULT), [
    { type: "result", isError: false, text: "demo" },
  ]);
});

test("a tool result given as a plain string, and an error result, keep their text", () => {
  const line = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "Unknown space: x" }] },
    parent_tool_use_id: null,
  });
  assert.deepEqual(parseLine(line), [{ type: "tool_result", toolUseId: "t", isError: true, text: "Unknown space: x" }]);
});

test("noise, framing, and subagent chatter yield nothing", () => {
  assert.deepEqual(parseLine("Waiting for background work to finish"), []);
  assert.deepEqual(parseLine('{"type":"rate_limit_event"}'), []);
  assert.deepEqual(parseLine('{"type":"system","subtype":"status","status":"requesting"}'), []);
  assert.deepEqual(
    parseLine(JSON.stringify({ type: "stream_event", event: { type: "message_stop" }, parent_tool_use_id: null })),
    []
  );
  const sub = JSON.parse(TOOL_USE);
  sub.parent_tool_use_id = "toolu_parent";
  assert.deepEqual(parseLine(JSON.stringify(sub)), []);
});

test("a retry becomes a notice for the activity line", () => {
  const line = JSON.stringify({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, error: "overloaded" });
  assert.deepEqual(parseLine(line), [{ type: "notice", text: "Claude is busy; trying again (2 of 10)…" }]);
});

test("a failed result with no text says what kind of failure it was", () => {
  const line = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s-1" });
  assert.deepEqual(parseLine(line), [{ type: "result", isError: true, text: "Claude Code reported error_max_turns." }]);
});

test("a turn writes the prompt to stdin and streams the events it prints", async () => {
  // A stand-in for claude: echo the stdin message back as text, then the canned lines.
  const script = `
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const prompt = JSON.parse(input).message.content;
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  process.stdout.write(${JSON.stringify(INIT)} + "\\n");
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: prompt } }, parent_tool_use_id: null });
  process.stdout.write(${JSON.stringify(RESULT)});
});`;
  const kb = await makeTempKb();
  try {
    const seen: { command?: string; args?: string[]; cwd?: string } = {};
    const events: AgentEvent[] = [];
    const turn = startTurn({
      claudePath: "/somewhere/claude",
      sessionId: "s-1",
      resume: false,
      files: FILES,
      cwd: kb.dir,
      text: "hello there",
      onEvent: (event) => events.push(event),
      spawnImpl: (command, args, options) => {
        Object.assign(seen, { command, args, cwd: options.cwd });
        return spawn(process.execPath, ["-e", script], options);
      },
    });
    const { code } = await turn.done;
    assert.equal(code, 0);
    assert.equal(seen.command, "/somewhere/claude");
    assert.equal(seen.cwd, kb.dir);
    assert.deepEqual(
      events.map((e) => e.type),
      ["init", "text", "result"]
    );
    assert.deepEqual(events[1], { type: "text", text: "hello there" });
  } finally {
    await kb.cleanup();
  }
});

test("stopping a turn ends the process", async () => {
  const turn = startTurn({
    claudePath: "/somewhere/claude",
    sessionId: "s-1",
    resume: true,
    files: FILES,
    cwd: process.cwd(),
    text: "x",
    onEvent: () => {},
    spawnImpl: (_command, _args, options) => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options),
  });
  setTimeout(() => turn.stop(), 100);
  const { code } = await turn.done;
  assert.notEqual(code, 0);
});

test("the engine writes the MCP config and prompt, and runs from its own empty folder", async () => {
  const kb = await makeTempKb();
  try {
    const dir = path.join(kb.dir, "work");
    await fs.mkdir(dir, { recursive: true });
    const seen: { args?: string[]; cwd?: string } = {};
    const turn = await claudeEngine.startTurn({
      path: "/somewhere/claude",
      dir,
      mcp: { command: "/usr/bin/node", args: ["mcp.mjs"], env: { KB_DIR: kb.dir, KB25_COMMIT_VIA: "chat" } },
      prompt: "Be brief.",
      session: { id: "s-1", resume: false },
      text: "hi",
      onEvent: () => {},
      spawnImpl: (_command, args, options) => {
        Object.assign(seen, { args, cwd: options.cwd });
        return spawn(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => {})"], options);
      },
    });
    await turn.done;
    assert.equal(seen.cwd, path.join(dir, "claude"));
    const value = (flag: string) => seen.args?.[seen.args.indexOf(flag) + 1] ?? "";
    assert.equal(await fs.readFile(value("--append-system-prompt-file"), "utf8"), "Be brief.");
    assert.match(await fs.readFile(value("--mcp-config"), "utf8"), /"KB25_COMMIT_VIA": "chat"/);
    assert.equal(value("--session-id"), "s-1");
  } finally {
    await kb.cleanup();
  }
});

test("a resume of a session Claude no longer has counts as lost", () => {
  assert.equal(claudeEngine.lostSession("No conversation found with session ID: abc"), true);
  assert.equal(claudeEngine.lostSession("error: unknown option"), false);
});
