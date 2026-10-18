import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./agent-cli.js";
import { DISABLED_FEATURES, codexArgs, codexEngine, codexReader, tomlString } from "./codex-cli.js";
import { makeTempKb } from "./test-helpers.js";

const MCP = {
  command: "/usr/bin/node",
  args: ["/app/server/mcp.mjs"],
  env: { KB_DIR: "/Users/a/KB25", KB25_COMMIT_VIA: "chat" },
};

// Lines as `codex exec --json` (0.157.0) printed them, trimmed to what matters.
const LINES = {
  started: '{"type":"thread.started","thread_id":"01a14980-ac0d-7a93-98b0-c52b901dda45"}',
  turn: '{"type":"turn.started"}',
  aside: '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’ll locate the KB25 tools\\nand query the space list."}}',
  callStart:
    '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"kb25","tool":"kb_list_spaces","arguments":{},"result":null,"error":null,"status":"in_progress"}}',
  callDone:
    '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"kb25","tool":"kb_list_spaces","arguments":{},"result":{"content":[{"type":"text","text":"{\\"spaces\\":[]}"}]},"error":null,"status":"completed"}}',
  searchStart: '{"type":"item.started","item":{"id":"ws_1","type":"web_search","query":"","action":{"type":"other"}}}',
  searchDone:
    '{"type":"item.completed","item":{"id":"ws_1","type":"web_search","query":"latest node","action":{"type":"search","query":"latest node"},"results":[]}}',
  reply: '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"demo"}}',
  done: '{"type":"turn.completed","usage":{"input_tokens":87768,"output_tokens":140}}',
};

function read(lines: string[]): AgentEvent[] {
  const reader = codexReader();
  return lines.flatMap((line) => reader(line));
}

test("a turn's lines become init, the aside as a notice, the tool call, and the reply", () => {
  assert.deepEqual(read([LINES.started, LINES.turn, LINES.aside, LINES.callStart, LINES.callDone, LINES.reply, LINES.done]), [
    { type: "init", sessionId: "01a14980-ac0d-7a93-98b0-c52b901dda45" },
    { type: "notice", text: "I’ll locate the KB25 tools and query the space list." },
    { type: "assistant", blocks: [{ type: "tool_use", id: "item_1", name: "mcp__kb25__kb_list_spaces", input: {} }] },
    { type: "tool_result", toolUseId: "item_1", isError: false, text: '{"spaces":[]}' },
    { type: "text", text: "demo" },
    { type: "assistant", blocks: [{ type: "text", text: "demo" }] },
    { type: "result", isError: false, text: "" },
  ]);
});

test("a web search reads as Claude's WebSearch, announced once", () => {
  assert.deepEqual(read([LINES.searchStart, LINES.searchDone]), [
    { type: "assistant", blocks: [{ type: "tool_use", id: "ws_1", name: "WebSearch", input: { query: "" } }] },
  ]);
  // A search that only reports when done still shows up.
  assert.deepEqual(read([LINES.searchDone]), [
    { type: "assistant", blocks: [{ type: "tool_use", id: "ws_1", name: "WebSearch", input: { query: "latest node" } }] },
  ]);
});

test("a message with no tool call after it is the reply, however many there are", () => {
  const second = LINES.reply.replace('"item_2"', '"item_3"').replace('"demo"', '"and more"');
  const events = read([LINES.reply, second, LINES.done]);
  assert.deepEqual(events.slice(0, 2), [
    { type: "text", text: "demo\n\nand more" },
    { type: "assistant", blocks: [{ type: "text", text: "demo\n\nand more" }] },
  ]);
});

test("a failed tool call and a failed turn say so", () => {
  const failedCall =
    '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"kb25","tool":"kb_create_page","arguments":{"title":"X"},"result":null,"error":{"message":"tool timed out"},"status":"failed"}}';
  assert.deepEqual(read([failedCall]), [
    { type: "assistant", blocks: [{ type: "tool_use", id: "item_1", name: "mcp__kb25__kb_create_page", input: { title: "X" } }] },
    { type: "tool_result", toolUseId: "item_1", isError: true, text: "tool timed out" },
  ]);
  assert.deepEqual(read(['{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}']), [
    { type: "result", isError: true, text: "You've hit your usage limit." },
  ]);
  assert.deepEqual(read(['{"type":"error","message":"Reconnecting... 1/5"}']), [
    { type: "notice", text: "Codex: Reconnecting... 1/5" },
  ]);
});

test("noise and lines that are not JSON yield nothing", () => {
  assert.deepEqual(read(["warming up", LINES.turn, '{"type":"item.completed","item":{"type":"reasoning","text":"…"}}']), []);
});

test("TOML values are literal strings unless they cannot be", () => {
  assert.equal(tomlString("C:\\Users\\a\\node.exe"), "'C:\\Users\\a\\node.exe'");
  assert.equal(tomlString("it's"), '"it\'s"');
  assert.equal(tomlString("two\nlines"), '"two\\nlines"');
});

test("a new turn attaches kb25 alone, switches the extra tools off, and reads stdin", () => {
  const args = codexArgs({ sessionId: "ignored", resume: false, mcp: MCP });
  assert.deepEqual(args.slice(0, 9), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--disable",
  ]);
  for (const feature of ["shell_tool", "unified_exec", "computer_use", "browser_use"]) {
    assert.ok(DISABLED_FEATURES.includes(feature));
    assert.ok(args.includes(feature));
  }
  assert.ok(args.includes("web_search='live'"));
  assert.ok(args.includes("mcp_servers.kb25.command='/usr/bin/node'"));
  assert.ok(args.includes("mcp_servers.kb25.args=['/app/server/mcp.mjs']"));
  assert.ok(args.includes("mcp_servers.kb25.env={KB_DIR='/Users/a/KB25', KB25_COMMIT_VIA='chat'}"));
  // exec has nobody to approve a write, so kb25's tools are approved up front.
  assert.ok(args.includes("mcp_servers.kb25.default_tools_approval_mode='approve'"));
  assert.equal(args.includes("resume"), false);
  assert.equal(args.at(-1), "-");
});

test("a later turn resumes the session Codex named, after the exec options", () => {
  const args = codexArgs({ sessionId: "01a14980-ac0d", resume: true, mcp: MCP });
  assert.deepEqual(args.slice(-3), ["resume", "01a14980-ac0d", "-"]);
  assert.ok(args.indexOf("--json") < args.indexOf("resume"));
});

test("a model and effort level are set only when chosen, before any resume", () => {
  const plain = codexArgs({ sessionId: "01a14980-ac0d", resume: true, mcp: MCP });
  assert.equal(plain.some((a) => a.startsWith("model")), false);
  const chosen = codexArgs({ sessionId: "01a14980-ac0d", resume: true, mcp: MCP, model: "gpt-5.6-terra", effort: "high" });
  const model = chosen.indexOf("model='gpt-5.6-terra'");
  const effort = chosen.indexOf("model_reasoning_effort='high'");
  assert.equal(chosen[model - 1], "-c");
  assert.equal(chosen[effort - 1], "-c");
  assert.ok(model < chosen.indexOf("resume") && effort < chosen.indexOf("resume"));
});

test("the engine writes its instructions as AGENTS.md in its own folder and runs there", async () => {
  const kb = await makeTempKb();
  try {
    const dir = path.join(kb.dir, "work");
    const seen: { command?: string; args?: string[]; cwd?: string; input?: string } = {};
    const events: AgentEvent[] = [];
    const turn = await codexEngine.startTurn({
      path: "/somewhere/codex",
      dir,
      mcp: MCP,
      prompt: "Be brief.",
      session: { id: "unused", resume: false },
      text: "hello",
      onEvent: (event) => events.push(event),
      spawnImpl: (command, args, options) => {
        Object.assign(seen, { command, args, cwd: options.cwd });
        // Echo stdin back as Codex would answer it.
        const script = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(${JSON.stringify(LINES.started)}+"\\n");process.stdout.write(JSON.stringify({type:"item.completed",item:{id:"i",type:"agent_message",text:s}})+"\\n");process.stdout.write(${JSON.stringify(LINES.done)}+"\\n")})`;
        return spawn(process.execPath, ["-e", script], options);
      },
    });
    const { code } = await turn.done;
    assert.equal(code, 0);
    assert.equal(seen.command, "/somewhere/codex");
    assert.equal(seen.cwd, path.join(dir, "codex"));
    assert.equal(await fs.readFile(path.join(dir, "codex", "AGENTS.md"), "utf8"), "Be brief.");
    assert.deepEqual(
      events.map((e) => e.type),
      ["init", "text", "assistant", "result"]
    );
    assert.deepEqual(events[1], { type: "text", text: "hello" });
  } finally {
    await kb.cleanup();
  }
});

test("a resume of a session Codex no longer has counts as lost", () => {
  assert.equal(
    codexEngine.lostSession(
      "Error: thread/resume: thread/resume failed: no rollout found for thread id 01a14981-0000-7000-8000-000000000000 (code -32600)"
    ),
    true
  );
  assert.equal(codexEngine.lostSession("Error: unexpected argument"), false);
});
