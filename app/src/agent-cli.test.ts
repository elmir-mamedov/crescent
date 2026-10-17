import { test } from "node:test";
import assert from "node:assert/strict";
import { lineSplitter, parseVersion, programCandidates, versionAtLeast } from "./agent-cli.js";

test("versions parse out of either program's --version and compare numerically", () => {
  assert.equal(parseVersion("2.1.302 (Claude Code)\n"), "2.1.302");
  assert.equal(parseVersion("codex-cli 0.157.0\n"), "0.157.0");
  assert.equal(parseVersion("command not found"), null);
  assert.equal(versionAtLeast("2.1.302", "2.1.259"), true);
  assert.equal(versionAtLeast("2.1.259", "2.1.259"), true);
  assert.equal(versionAtLeast("2.1.99", "2.1.259"), false);
  assert.equal(versionAtLeast("3.0.0", "2.1.259"), true);
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
