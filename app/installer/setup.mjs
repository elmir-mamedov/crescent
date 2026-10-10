// The KB25 setup wizard. install.sh / install.ps1 fetch Node and the release
// into KB25_HOME/app.new and run this with that Node; everything after the
// first "Continue? [Y/n]" happens here, the same way on macOS and Windows.
// Every question is a [Y/n] with a sensible default, so Enter always works.
//
// Non-interactive switches, for CI: KB25_YES=1 takes every default,
// KB25_UNINSTALL=1 removes KB25, KB25_NO_BROWSER=1 is passed on to the launcher.
import { execFileSync, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  isMac,
  isWindows,
  paths,
  powershell,
  psEncode,
  psQuote,
  readEnvFile,
  stopServer,
  tildify,
} from "./common.mjs";
import { removeMacApp, sh, writeMacApp } from "./mac-app.mjs";

/** The release this wizard came with: KB25_HOME/app.new, or app/ when run from an install. */
const staged = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = paths();

const MAC_APP = path.join(os.homedir(), "Applications", "KB25.app");
const START_MENU_LINK = path.join(
  process.env.APPDATA ?? "",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "KB25.lnk"
);
const CLAUDE_DESKTOP_DIR = isMac
  ? path.join(os.homedir(), "Library", "Application Support", "Claude")
  : path.join(process.env.APPDATA ?? "", "Claude");
const CLAUDE_DESKTOP_CONFIG = path.join(CLAUDE_DESKTOP_DIR, "claude_desktop_config.json");
const SKILL_DIR = path.join(os.homedir(), ".claude", "skills", "kb-page-authoring");
/** Marks a skill folder as ours, so removal never deletes someone's own skill. */
const SKILL_MARKER = ".installed-by-kb25";

try {
  await main();
} catch (error) {
  console.error(`\nSomething went wrong: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

async function main() {
  if (process.env.KB25_UNINSTALL) return uninstall();

  const version = readVersion(staged);
  const installed = staged === p.app ? version : readVersion(p.app);
  if (installed === version) {
    console.log(`KB25 ${version} is already up to date.`);
    if (staged !== p.app) fs.rmSync(staged, { recursive: true, force: true });
    if (await ask("Remove KB25 from this computer?", false)) return uninstall();
  } else {
    await stopServer(p); // an update must not keep serving the old version
    replaceApp();
    console.log(installed ? `Updated KB25 ${installed} → ${version}.` : `Installed KB25 ${version}.`);
  }

  const kbDir = await ensureSettings();
  console.log(`Your pages are kept in ${tildify(kbDir)}`);
  createLauncher();
  await connectClaudeDesktop();
  await connectClaudeCode();

  const where = isMac ? 'Spotlight (Cmd+Space, type "KB25")' : 'the Start menu (type "KB25")';
  console.log(`\nAll set! Open KB25 any time from ${where}.`);
  if (await ask("Open KB25 now?")) {
    spawn(p.node, [p.launcher], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}

async function ask(question, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  if (process.env.KB25_YES) {
    console.log(`${question} ${hint} → ${defaultYes ? "yes" : "no"}`);
    return defaultYes;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${hint} `)).trim().toLowerCase();
    return answer ? answer.startsWith("y") : defaultYes;
  } finally {
    rl.close();
  }
}

function readVersion(dir) {
  try {
    return fs.readFileSync(path.join(dir, "VERSION"), "utf8").trim();
  } catch {
    return null;
  }
}

/** Swap app.new in for app, so a failed download never leaves a half-updated install. */
function replaceApp() {
  const old = `${p.app}.old`;
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(p.app)) fs.renameSync(p.app, old);
  fs.renameSync(staged, p.app);
  fs.rmSync(old, { recursive: true, force: true });
}

/** Write KB25_HOME/.env on first install; keep it, and the pages, on every later run. */
async function ensureSettings() {
  const existing = readEnvFile(p.envFile).KB_DIR;
  if (existing) {
    fs.mkdirSync(existing, { recursive: true });
    return existing;
  }
  const kbDir = path.join(os.homedir(), "KB25");
  fs.mkdirSync(kbDir, { recursive: true });
  fs.writeFileSync(
    p.envFile,
    [
      "# KB25 settings, written by the installer and kept across updates.",
      "# Sign-in is off: KB25 only answers on this computer (localhost).",
      `KB_DIR=${kbDir}`,
      `PORT=${await freePort(4000)}`,
      "AUTH_DISABLED=1",
      "",
    ].join("\n")
  );
  return kbDir;
}

async function freePort(from) {
  for (let port = from; port < from + 100; port++) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "localhost", () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free port between ${from} and ${from + 99}.`);
}

/** KB25 in Spotlight (macOS) or the Start menu (Windows), with the KB25 icon. */
function createLauncher() {
  if (isMac) {
    writeMacApp({
      bundle: MAC_APP,
      script: `#!/bin/sh\nexec ${sh(p.node)} ${sh(p.launcher)}\n`,
      iconPng: path.join(p.app, "public", "favicon-512x512.png"),
    });
  } else if (isWindows) {
    // A hidden PowerShell runs the launcher, so no console window stays open.
    const target = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const args = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ${psEncode(
      `& ${psQuote(p.node)} ${psQuote(p.launcher)}`
    )}`;
    fs.mkdirSync(path.dirname(START_MENU_LINK), { recursive: true });
    powershell(
      [
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(START_MENU_LINK)})`,
        `$s.TargetPath = ${psQuote(target)}`,
        `$s.Arguments = ${psQuote(args)}`,
        `$s.WorkingDirectory = ${psQuote(p.home)}`,
        `$s.IconLocation = ${psQuote(path.join(p.app, "public", "favicon.ico"))}`,
        "$s.WindowStyle = 7",
        "$s.Save()",
      ].join("; ")
    );
  }
}

function claudeDesktopInstalled() {
  const apps = isMac
    ? ["/Applications/Claude.app", path.join(os.homedir(), "Applications", "Claude.app")]
    : [path.join(process.env.LOCALAPPDATA ?? "", "AnthropicClaude")];
  return fs.existsSync(CLAUDE_DESKTOP_DIR) || apps.some((app) => fs.existsSync(app));
}

/** Read claude_desktop_config.json; null when it exists but is not valid JSON. */
function readClaudeDesktopConfig() {
  if (!fs.existsSync(CLAUDE_DESKTOP_CONFIG)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_DESKTOP_CONFIG, "utf8"));
  } catch {
    return null;
  }
}

async function connectClaudeDesktop() {
  if (!claudeDesktopInstalled()) return;
  const config = readClaudeDesktopConfig();
  if (!config) {
    console.log("Couldn't read the Claude app's settings file, so KB25 wasn't connected to it.");
    return;
  }
  const entry = { command: p.node, args: [p.mcp] };
  if (JSON.stringify(config.mcpServers?.kb25) === JSON.stringify(entry)) {
    console.log("The Claude app is already connected to KB25.");
    return;
  }
  if (!(await ask("Connect KB25 to the Claude app?"))) return;
  config.mcpServers = { ...config.mcpServers, kb25: entry };
  fs.mkdirSync(CLAUDE_DESKTOP_DIR, { recursive: true });
  fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  console.log("Connected. Quit and reopen the Claude app to use KB25 there.");
}

function disconnectClaudeDesktop() {
  const config = readClaudeDesktopConfig();
  if (config?.mcpServers?.kb25?.command !== p.node) return;
  delete config.mcpServers.kb25;
  fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

/** Run the Claude Code CLI; its stdout, or null when it is missing or fails. */
function claude(args) {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 };
    // On Windows `claude` may be a .cmd shim, which only a shell can run.
    return isWindows
      ? execSync(["claude", ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" "), options)
      : execFileSync("claude", args, options);
  } catch {
    return null;
  }
}

async function connectClaudeCode() {
  if (claude(["--version"]) === null) return;
  if (claude(["mcp", "get", "kb25"])?.includes(p.mcp)) {
    console.log("Claude Code is already connected to KB25.");
  } else {
    if (!(await ask("Connect KB25 to Claude Code?"))) return;
    if (claude(["mcp", "add", "--scope", "user", "kb25", "--", p.node, p.mcp]) === null) {
      console.log("Claude Code didn't accept the connection, so it was skipped.");
      return;
    }
    console.log("Connected. Start a new Claude Code session to use KB25 there.");
  }
  installSkill();
}

/** The page-writing skill, refreshed on every run so it tracks the installed version. */
function installSkill() {
  const source = path.join(p.app, "skills", "kb-page-authoring");
  if (!fs.existsSync(source)) return;
  if (fs.existsSync(SKILL_DIR) && !fs.existsSync(path.join(SKILL_DIR, SKILL_MARKER))) return;
  fs.rmSync(SKILL_DIR, { recursive: true, force: true });
  fs.cpSync(source, SKILL_DIR, { recursive: true });
  fs.writeFileSync(path.join(SKILL_DIR, SKILL_MARKER), "");
}

function disconnectClaudeCode() {
  if (claude(["mcp", "get", "kb25"])?.includes(p.mcp)) {
    claude(["mcp", "remove", "--scope", "user", "kb25"]);
  }
  if (fs.existsSync(path.join(SKILL_DIR, SKILL_MARKER))) {
    fs.rmSync(SKILL_DIR, { recursive: true, force: true });
  }
}

/** Remove everything KB25 installed. The pages stay where they are. */
async function uninstall() {
  const kbDir = readEnvFile(p.envFile).KB_DIR;
  await stopServer(p);
  if (isMac) removeMacApp(MAC_APP);
  if (isWindows) fs.rmSync(START_MENU_LINK, { force: true });
  disconnectClaudeDesktop();
  disconnectClaudeCode();

  if (isWindows) {
    // This wizard is running on KB25_HOME\node\node.exe, which Windows will not
    // delete while it runs: remove the rest now, and the folder once it exits.
    for (const entry of fs.readdirSync(p.home)) {
      if (entry !== "node") fs.rmSync(path.join(p.home, entry), { recursive: true, force: true });
    }
    spawn(
      "cmd.exe",
      ["/d", "/s", "/c", `"ping -n 3 127.0.0.1 >nul & rmdir /s /q "${p.home}""`],
      { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }
    ).unref();
  } else {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
  console.log(`KB25 is removed.${kbDir ? ` Your pages are still in ${tildify(kbDir)}.` : ""}`);
}
