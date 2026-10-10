// Release CI only: checks a KB25 that install.sh / install.ps1 has just
// installed with KB25_YES=1 KB25_NO_BROWSER=1. The viewer must answer without
// a login, the MCP server must list its tools, the launcher must exist, and
// removal must clean up while leaving the pages alone.
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

// 2. The MCP server answers tools/list.
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

// 3. The launcher is where Spotlight / the Start menu look for it.
const launcher = isWindows
  ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "KB25.lnk")
  : path.join(os.homedir(), "Applications", "KB25.app");
assert.ok(fs.existsSync(launcher), `missing launcher ${launcher}`);
console.log(`launcher: ${launcher}`);

// 4. Removal takes everything but the pages.
execFileSync(node, [path.join(home, "app", "installer", "setup.mjs")], {
  env: { ...process.env, KB25_UNINSTALL: "1" },
  stdio: "inherit",
});
for (let i = 0; i < 40 && fs.existsSync(home); i++) await sleep(250);
assert.ok(!fs.existsSync(home), `${home} should be gone`);
assert.ok(!fs.existsSync(launcher), "the launcher should be gone");
assert.ok(fs.existsSync(env.KB_DIR), "the pages must survive removal");
console.log("uninstall: clean, pages kept");
