import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isEffortName,
  isModelName,
  lineSplitter,
  parseVersion,
  programCandidates,
  runQuiet,
  startProcessTurn,
  versionAtLeast,
} from "./agent-cli.js";
import { turnArgs, turnInput } from "./claude-cli.js";
import { codexArgs } from "./codex-cli.js";
import { makeTempKb } from "./test-helpers.js";

test("versions parse out of either program's --version and compare numerically", () => {
  assert.equal(parseVersion("2.1.302 (Claude Code)\n"), "2.1.302");
  assert.equal(parseVersion("codex-cli 0.157.0\n"), "0.157.0");
  assert.equal(parseVersion("command not found"), null);
  assert.equal(versionAtLeast("2.1.302", "2.1.259"), true);
  assert.equal(versionAtLeast("2.1.259", "2.1.259"), true);
  assert.equal(versionAtLeast("2.1.99", "2.1.259"), false);
  assert.equal(versionAtLeast("3.0.0", "2.1.259"), true);
});

test("model and effort names are the programs' own, and nothing that reads as a flag", () => {
  for (const name of ["opus", "claude-haiku-4-5-20251001", "gpt-5.6-terra", "sonnet[1m]"]) {
    assert.equal(isModelName(name), true, name);
  }
  for (const name of ["", "-p", "--model", "opus high", "a'b", "x".repeat(101)]) {
    assert.equal(isModelName(name), false, name);
  }
  assert.equal(isEffortName("xhigh"), true);
  for (const name of ["", "High", "-x", "max\n"]) assert.equal(isEffortName(name), false, name);
});

test("lines split across chunks come out whole", () => {
  const lines: string[] = [];
  const splitter = lineSplitter((line) => lines.push(line));
  splitter.push('{"a":');
  splitter.push('1}\r\n{"b"');
  splitter.push(":2}\n\n");
  splitter.push('{"c":3}');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  splitter.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("only Claude Code gets its legacy ~/.claude/local folder searched", () => {
  const codex = programCandidates("codex", "KB25_CODEX_PATH", { PATH: "/usr/bin" }, "darwin", "/Users/a");
  assert.deepEqual(codex.slice(0, 4), [
    "/usr/bin/codex",
    "/Users/a/.local/bin/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ]);
  assert.deepEqual(programCandidates("codex", "KB25_CODEX_PATH", { KB25_CODEX_PATH: "/x/codex" }, "darwin", "/Users/a"), [
    "/x/codex",
  ]);
});

// An npm-installed claude or codex on Windows is a .cmd shim, which only runs
// through cmd.exe, so the chat quotes every argument itself. These run the
// chat's real arguments through a shim built the way npm builds them and check
// that each one, and the message on stdin, arrives exactly as sent.
const windowsOnly = { skip: process.platform !== "win32" && "Windows only: .cmd shims run through cmd.exe" };

/** A shim like npm's (`"node.exe" "<script>" %*`) in a folder with spaces and parentheses, echoing what it got. */
async function fakeShim(name: string) {
  const kb = await makeTempKb();
  const dir = path.join(kb.dir, "Program Files (x86)", "npm");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.js`),
    `const args = process.argv.slice(2);
const report = (stdin) => process.stdout.write(JSON.stringify({ args, stdin }) + "\\n");
if (args.includes("--version")) report(null);
else { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => report(s)); }
`
  );
  const shim = path.join(dir, `${name}.cmd`);
  await fs.writeFile(shim, `@ECHO off\r\n"${process.execPath}" "%~dp0${name}.js" %*\r\n`);
  return { shim, cleanup: kb.cleanup };
}

/** Run one turn through `shim` with the real process plumbing; what the program received. */
async function throughShim(shim: string, args: string[], input: string): Promise<{ args: string[]; stdin: string }> {
  let received: { args: string[]; stdin: string } | undefined;
  const turn = startProcessTurn({
    command: shim,
    args,
    cwd: os.tmpdir(),
    input,
    readLine: (line) => {
      received = JSON.parse(line);
      return [];
    },
    onEvent: () => {},
  });
  const { code, stderr } = await turn.done;
  assert.equal(code, 0, stderr);
  assert.ok(received, "the shim printed nothing");
  return received;
}

const AWKWARD = 'What is "TCP & UDP"? (100% sure) ^ <ok> | done\nA second line.';

test("windows: Codex's arguments and message survive a codex.cmd shim", windowsOnly, async () => {
  const { shim, cleanup } = await fakeShim("codex");
  try {
    const args = codexArgs({
      sessionId: "01a1498f-2501-78b3",
      resume: true,
      mcp: {
        command: "C:\\Program Files (x86)\\KB25\\node\\node.exe",
        args: ["C:\\Users\\Ada Lovelace\\AppData\\Local\\KB25\\app\\server\\mcp.mjs"],
        env: { KB_DIR: "C:\\Users\\Ada Lovelace\\KB25", KB25_COMMIT_VIA: "chat" },
      },
    });
    const received = await throughShim(shim, args, AWKWARD);
    assert.deepEqual(received.args, args);
    assert.equal(received.stdin, AWKWARD);
  } finally {
    await cleanup();
  }
});

test("windows: Claude Code's arguments and message survive a claude.cmd shim", windowsOnly, async () => {
  const { shim, cleanup } = await fakeShim("claude");
  try {
    const temp = "C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp\\kb25-chat-0123456789ab";
    const args = turnArgs({
      sessionId: "0b6f3a52-6d3e-4b8e-9a51-2f6c1d9e7a10",
      resume: false,
      files: { mcpConfig: `${temp}\\mcp.json`, systemPrompt: `${temp}\\prompt.md` },
    });
    const input = turnInput(AWKWARD);
    const received = await throughShim(shim, args, input);
    assert.deepEqual(received.args, args);
    assert.equal(received.stdin, input);
  } finally {
    await cleanup();
  }
});

test("windows: the status check reaches a shim in a folder with spaces", windowsOnly, async () => {
  const { shim, cleanup } = await fakeShim("codex");
  try {
    const result = await runQuiet(shim, ["--version"], 15000);
    assert.equal(result?.code, 0, result?.stderr);
    assert.deepEqual(JSON.parse(result?.stdout ?? "{}").args, ["--version"]);
  } finally {
    await cleanup();
  }
});
