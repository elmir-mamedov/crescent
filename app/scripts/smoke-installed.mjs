// Release CI only: checks a KB25 that install.sh / install.ps1 has just
// installed with KB25_YES=1 KB25_NO_BROWSER=1. The viewer must answer without
// a login, the chat must report its engines, the MCP server must list its
// tools, the launcher must exist, KB25's window must stop the server when it
// closes, and removal must clean up while leaving the pages alone.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isWindows = process.platform === "win32";
const home =
  process.env.KB25_HOME ??
  (isWindows
    ? path.join(process.env.LOCALAPPDATA, "KB25")
    : path.join(os.homedir(), "Library", "Application Support", "KB25"));
const node = isWindows ? path.join(home, "node", "node.exe") : path.join(home, "node", "bin", "node");
const env = {};
for (const line of fs.readFileSync(path.join(home, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (match) env[match[1]] = match[2];
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. The installer's "Open KB25 now?" started the viewer; it needs no login.
let response;
for (let i = 0; i < 120 && !response; i++) {
  response = await fetch(`http://localhost:${env.PORT}/`, { redirect: "manual" }).catch(() => null);
  if (!response) await sleep(250);
}
assert.ok(response, "the viewer never answered");
assert.equal(response.status, 200, "the viewer should open without a login");
console.log(`viewer: HTTP ${response.status} on port ${env.PORT}`);

// 2. The chat reports both engines. A runner has neither installed, so this
// checks that the bundled chat code loads and can look for them.
const chat = await fetch(`http://localhost:${env.PORT}/_chat/status?fresh=1`);
assert.equal(chat.status, 200, "the chat status should answer");
const { engines } = await chat.json();
assert.deepEqual(
  engines.map((engine) => engine.id),
  ["claude", "codex"]
);
for (const engine of engines) {
  assert.ok(
    ["ok", "missing", "signed-out", "too-old", "broken"].includes(engine.status.state),
    `unexpected ${engine.id} state ${JSON.stringify(engine.status)}`
  );
}
console.log(`chat: ${engines.map((engine) => `${engine.id} ${engine.status.state}`).join(", ")}`);

// 3. The MCP server answers tools/list.
const mcp = spawn(node, [path.join(home, "app", "server", "mcp.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
let out = "";
mcp.stdout.on("data", (chunk) => (out += chunk));
const send = (message) => mcp.stdin.write(`${JSON.stringify(message)}\n`);
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
let tools;
for (let i = 0; i < 80 && !tools; i++) {
  await sleep(250);
  tools = out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 2)?.result?.tools;
}
mcp.kill();
assert.ok(tools && tools.length >= 18, `expected the MCP tools, got ${tools?.length}`);
console.log(`mcp: ${tools.length} tools`);

// 4. The launcher is where Spotlight / the Start menu look for it.
const launcher = isWindows
  ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "KB25.lnk")
  : path.join(os.homedir(), "Applications", "KB25.app");
assert.ok(fs.existsSync(launcher), `missing launcher ${launcher}`);
console.log(`launcher: ${launcher}`);

// 5. KB25's window opens over the watcher's pipe, and its last window closing
// stops the server. A page that closes itself stands in for the person closing
// the window; headless, because a runner has nobody to show it to.
const watcher = spawn(
  node,
  [
    path.join(home, "app", "installer", "window.mjs"),
    "watch",
    `http://localhost:${env.PORT}`,
    home,
    "data:text/html,<title>KB25</title><script>setTimeout(() => close(), 1000)</script>",
  ],
  { env: { ...process.env, KB25_BROWSER_ARGS: "--headless=new" }, stdio: ["ignore", "pipe", "inherit"] }
);
let windowLog = "";
watcher.stdout.on("data", (chunk) => (windowLog += chunk));
const watched = await Promise.race([
  new Promise((resolve) => watcher.on("exit", () => resolve(true))),
  sleep(60_000).then(() => false),
]);
if (!watched) watcher.kill();
assert.match(windowLog, /KB25 window: open in /, `the window never opened:\n${windowLog}`);
assert.match(windowLog, /KB25 window: last window closed/, `the window never closed:\n${windowLog}`);
let stopped = false;
for (let i = 0; i < 40 && !stopped; i++) {
  stopped = !(await fetch(`http://localhost:${env.PORT}/`).then(() => true, () => false));
  if (!stopped) await sleep(250);
}
assert.ok(stopped, "closing KB25's window should stop the server");
console.log(`window: ${windowLog.trim().split("\n").join("; ")}`);

// 6. Removal takes everything but the pages.
execFileSync(node, [path.join(home, "app", "installer", "setup.mjs")], {
  env: { ...process.env, KB25_UNINSTALL: "1" },
  stdio: "inherit",
});
for (let i = 0; i < 40 && fs.existsSync(home); i++) await sleep(250);
assert.ok(!fs.existsSync(home), `${home} should be gone`);
assert.ok(!fs.existsSync(launcher), "the launcher should be gone");
assert.ok(fs.existsSync(env.KB_DIR), "the pages must survive removal");
console.log("uninstall: clean, pages kept");
