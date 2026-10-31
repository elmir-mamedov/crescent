// The KB25 setup wizard. install.sh / install.ps1 fetch Node and the release
// into KB25_HOME/app.new and run this with that Node; everything after the
// first "Continue? [Y/n]" happens here, the same way on macOS and Windows.
// Every question is a [Y/n] with a sensible default, so Enter always works.
//
// Non-interactive switches, for CI: KB25_YES=1 takes every default,
// KB25_UNINSTALL=1 removes KB25, KB25_NO_BROWSER=1 starts the server without
// opening KB25's window.
// KB25_UPDATE=1 is the viewer's Update button: it answers no to every question,
// because an update changes the app and never the choices made at install, and
// it restarts Crescent on the new version: an open window is closed and opened
// again, and otherwise the server restarts in the background.
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
  psQuote,
  readEnvFile,
  sleep,
  stopServer,
  tildify,
} from "./common.mjs";
import { removeMacApp, writeMacApp } from "./mac-app.mjs";

/** The release this wizard came with: KB25_HOME/app.new, or app/ when run from an install. */
const staged = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = paths();
const UPDATING = Boolean(process.env.KB25_UPDATE);

const MAC_APP = path.join(os.homedir(), "Applications", "Crescent.app");
const START_MENU_LINK = path.join(
  process.env.APPDATA ?? "",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Crescent.lnk"
);
/** What KB25 0.12.0 and earlier named them; an update replaces them with the two above. */
const OLD_MAC_APP = path.join(os.homedir(), "Applications", "KB25.app");
const OLD_START_MENU_LINK = path.join(path.dirname(START_MENU_LINK), "KB25.lnk");
const CLAUDE_DESKTOP_DIR = isMac
  ? path.join(os.homedir(), "Library", "Application Support", "Claude")
  : path.join(process.env.APPDATA ?? "", "Claude");
const CLAUDE_DESKTOP_CONFIG = path.join(CLAUDE_DESKTOP_DIR, "claude_desktop_config.json");
/** The per-user file src/mcp.ts reads KB_DIR from; the retired kb25 plugin kept it there. */
const USER_ENV_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "kb25",
  ".env"
);
const SKILL_DIR = path.join(os.homedir(), ".claude", "skills", "kb-page-authoring");
/**
 * Where an install's port search starts: clear of the ports dev servers take
 * (3000, 4000, 5173, 8000, 8080, a KB25 checkout's 4000) and below every
 * system's ephemeral range (32768 on Linux, 49152 on macOS and Windows), which
 * outgoing connections borrow ports from.
 */
const PORT_FROM = 25250;
/** Where KB25 0.5.0 and earlier started it, which collided with those dev servers. */
const OLD_PORT_FROM = 4000;
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
  if (UPDATING && !installed) throw new Error("Crescent isn't installed here, so there is nothing to update.");
  if (installed === version) {
    console.log(`Crescent ${version} is already up to date.`);
    if (staged !== p.app) fs.rmSync(staged, { recursive: true, force: true });
    if (await ask("Remove Crescent from this computer?", false)) return uninstall();
  } else {
    await stopServer(p); // an update must not keep serving the old version
    replaceApp();
    console.log(installed ? `Updated Crescent ${installed} → ${version}.` : `Installed Crescent ${version}.`);
  }

  const kbDir = await ensureSettings();
  console.log(`Your pages are kept in ${tildify(kbDir)}`);
  const movedFrom = await moveOffDevPort();
  // The server answers the old port for a while, for the page still on it.
  const moved = movedFrom ? { KB25_MOVED_FROM: String(movedFrom) } : {};
  const window = createLauncher();
  await connectClaudeDesktop();
  await connectClaudeCode();

  if (UPDATING) {
    // KB25_NO_BROWSER comes from the window, by way of the server that ran this.
    const { KB25_UPDATE, KB25_NO_BROWSER, ...env } = process.env;
    // An open window would go on running the old version's window until it was
    // quit. Restart it on the new one, as quitting and opening Crescent would:
    // its server first, which an update to the same version left running.
    if (window && openWindows().length) {
      await stopServer(p);
      await closeWindow();
      openKb25(window, { ...env, ...moved }, { fresh: true });
      console.log("Restarted Crescent on the new version.");
      return;
    }
    // No window (a browser tab): the server was stopped before the app was
    // swapped; start it again on the new version for the page waiting on it.
    launch({ ...env, ...moved, KB25_NO_BROWSER: "1" });
    console.log("Starting Crescent again in the background.");
    return;
  }
  const where = isMac ? 'Spotlight (Cmd+Space, type "Crescent")' : 'the Start menu (type "Crescent")';
  console.log(`\nAll set! Open Crescent any time from ${where}.`);
  if (await ask("Open Crescent now?")) openKb25(window, { ...process.env, ...moved });
}

/** Run the launcher, which starts the server unless it answers already. */
function launch(env) {
  spawn(p.node, [p.launcher], { detached: true, stdio: "ignore", windowsHide: true, env }).unref();
}

/**
 * Start the server, then open KB25's window, which finds it answering. Started
 * here rather than by the window so the server gets this wizard's environment
 * (KB25_MOVED_FROM), which an app opened through Finder would not pass on.
 * `fresh` opens a new copy of the app on macOS, for a restart: the one just
 * quit may not have left LaunchServices yet, and `open` would only wake it.
 */
function openKb25(window, env, { fresh = false } = {}) {
  try {
    execFileSync(p.node, [p.launcher], {
      env: { ...env, KB25_NO_BROWSER: "1" },
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    return; // the launcher has already said why, in a dialog
  }
  if (env.KB25_NO_BROWSER || !window) return;
  const [command, args] = isMac ? ["open", fresh ? ["-n", window] : [window]] : [window, []];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

/**
 * The pids of KB25's windows now open. KB25.app's as well: a window opened
 * from it keeps running through the update that replaces it with Crescent.app.
 */
function openWindows() {
  if (isMac) {
    return [MAC_APP, OLD_MAC_APP].flatMap((bundle) => {
      try {
        const out = execFileSync("pgrep", ["-f", path.join(bundle, "Contents", "MacOS", "KB25")], { encoding: "utf8" });
        return out.split("\n").filter(Boolean).map(Number);
      } catch {
        return []; // none open
      }
    });
  }
  if (isWindows) {
    try {
      const out = powershell(
        `Get-Process KB25 -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ${psQuote(`${p.shells}\\*`)} } | ForEach-Object { $_.Id }`
      );
      return out.split(/\s+/).filter(Boolean).map(Number);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Close KB25's windows, if any are open, and wait until they have gone: their
 * files are about to go, or a new version is to open in their place. Each is
 * asked to quit the way a person quits it, so it saves where it was; one that
 * has not gone within a few seconds is stopped.
 */
async function closeWindow() {
  const pids = openWindows();
  if (!pids.length) return;
  const running = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (isMac) {
    // KB25.swift quits on SIGTERM as it does on Cmd+Q.
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  } else if (isWindows) {
    try {
      powershell(
        `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }`
      );
    } catch {}
  }
  for (let waited = 0; waited < 5000 && pids.some(running); waited += 100) await sleep(100);
  for (const pid of pids.filter(running)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  for (let waited = 0; waited < 2000 && pids.some(running); waited += 100) await sleep(100);
}

async function ask(question, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  if (UPDATING) {
    console.log(`${question} ${hint} → no (updating)`);
    return false;
  }
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

/**
 * Write KB25_HOME/.env on first install; keep it, and the pages, on every later
 * run. Until KB25 holds a space, offer a knowledge base set up before it.
 */
async function ensureSettings() {
  const current = readEnvFile(p.envFile).KB_DIR;
  if (current && spaces(current).length > 0) return current;
  const adopted = await adoptExistingKb(current);

  if (current) {
    if (!adopted) {
      fs.mkdirSync(current, { recursive: true });
      return current;
    }
    setEnvValue("KB_DIR", adopted);
    await stopServer(p); // it still serves the empty folder
    try {
      fs.rmdirSync(current); // fails, harmlessly, unless the folder is empty
    } catch {}
    console.log("If the Claude app or Claude Code is open, restart it to see these pages there.");
    return adopted;
  }

  const kbDir = adopted ?? path.join(os.homedir(), "Crescent");
  fs.mkdirSync(kbDir, { recursive: true });
  fs.writeFileSync(
    p.envFile,
    [
      "# Crescent settings, written by the installer and kept across updates.",
      "# Sign-in is off: Crescent only answers on this computer (localhost).",
      `KB_DIR=${kbDir}`,
      `PORT=${await freePort(PORT_FROM)}`,
      "AUTH_DISABLED=1",
      "",
    ].join("\n")
  );
  return kbDir;
}

/** Replace the `key=` line in KB25_HOME/.env. */
function setEnvValue(key, value) {
  const lines = fs.readFileSync(p.envFile, "utf8").split(/\r?\n/);
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  fs.writeFileSync(p.envFile, lines.map((line) => (pattern.test(line) ? `${key}=${value}` : line)).join("\n"));
}

/**
 * Move a copy that KB25 0.5.0 or earlier put on a port from 4000 into the
 * range new installs get: a dev server started there later would stand in
 * KB25's way. Returns the port it left, or null when it stays where it is.
 */
async function moveOffDevPort() {
  const port = Number(readEnvFile(p.envFile).PORT);
  if (!(port >= OLD_PORT_FROM && port < OLD_PORT_FROM + 100)) return null;
  await stopServer(p); // an up-to-date copy is still running on the old port
  const next = await freePort(PORT_FROM);
  setEnvValue("PORT", next);
  console.log(`Crescent moved from port ${port} to ${next}, out of the way of dev servers.`);
  return port;
}

/** Offer each knowledge base set up before KB25 in turn; the one accepted, or null. */
async function adoptExistingKb(current) {
  for (const dir of existingKbs(current)) {
    const names = spaces(dir);
    const shown =
      names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
    const count = `${names.length} ${names.length === 1 ? "space" : "spaces"}`;
    console.log(`Found a knowledge base at ${tildify(dir)} (${count}: ${shown}).`);
    if (await ask("Use it for Crescent?")) return dir;
  }
  return null;
}

/**
 * Knowledge bases named in the per-user settings file, or by a hand-written
 * Claude app entry (which connectClaudeDesktop is about to replace), or left in
 * ~/KB25, where KB25 0.12.0 and earlier put new installs' pages, that hold at
 * least one space and are not `current`.
 */
function existingKbs(current) {
  const named = [
    readEnvFile(USER_ENV_FILE).KB_DIR,
    readClaudeDesktopConfig()?.mcpServers?.kb25?.env?.KB_DIR,
    path.join(os.homedir(), "KB25"),
  ];
  const found = new Set();
  for (const dir of named) {
    if (typeof dir !== "string" || !path.isAbsolute(expandHome(dir))) continue;
    const resolved = path.resolve(expandHome(dir));
    if (current && resolved === path.resolve(current)) continue;
    if (spaces(resolved).length > 0) found.add(resolved);
  }
  return [...found];
}

/** A knowledge base's spaces: its top-level folders, minus those content.ts skips. */
function spaces(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !/^[._]/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Read a leading ~ as the home folder, as the MCP server does for KB_DIR. */
function expandHome(file) {
  if (file === "~") return os.homedir();
  if (file.startsWith("~/")) return path.join(os.homedir(), file.slice(2));
  return file;
}

/**
 * The first port from `from` that is free on both loopback addresses. The
 * server binds "localhost", which is 127.0.0.1 and ::1, and probing "localhost"
 * itself only tries the first of them: a port another program holds on the
 * other (Jekyll's 127.0.0.1:4000, say) would pass, KB25 would then fail to
 * start, and the launcher would open that program in its place.
 */
async function freePort(from) {
  for (let port = from; port < from + 100; port++) {
    if ((await canListen(port, "127.0.0.1")) && (await canListen(port, "::1"))) return port;
  }
  throw new Error(`No free port between ${from} and ${from + 99}.`);
}

/** Whether `port` is free on `host`. A machine without IPv6 counts as free on ::1. */
function canListen(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error) =>
      resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")
    );
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * KB25's window in Spotlight (macOS) or the Start menu (Windows), with the
 * KB25 icon. Returns what opens it: the app bundle, or KB25.exe.
 */
function createLauncher() {
  if (isMac) {
    writeMacApp({
      bundle: MAC_APP,
      executable: p.macShell,
      start: [p.node, p.launcher],
      version: readVersion(p.app),
      iconPng: path.join(p.app, "public", "favicon-512x512.png"),
    });
    removeMacApp(OLD_MAC_APP);
    return MAC_APP;
  }
  if (isWindows) {
    const exe = installWindowsShell();
    fs.mkdirSync(path.dirname(START_MENU_LINK), { recursive: true });
    powershell(
      [
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(START_MENU_LINK)})`,
        `$s.TargetPath = ${psQuote(exe)}`,
        `$s.Arguments = ''`,
        `$s.WorkingDirectory = ${psQuote(p.home)}`,
        `$s.IconLocation = ${psQuote(`${exe},0`)}`,
        "$s.WindowStyle = 1",
        "$s.Save()",
      ].join("; ")
    );
    fs.rmSync(OLD_START_MENU_LINK, { force: true });
    return exe;
  }
  return null;
}

/**
 * Copy KB25.exe out of app/ into shell/<version>/ and return its path. Windows
 * locks a running program's files, and an update replaces app/ while the
 * window is open; the older version's folder goes once its window has closed.
 * A folder is renamed away before it is removed, so one still in use is left
 * whole rather than half deleted.
 */
function installWindowsShell() {
  const version = readVersion(p.app);
  const target = path.join(p.shells, version);
  const discard = (dir) => {
    const gone = `${dir}.old-${process.pid}`;
    try {
      fs.renameSync(dir, gone);
    } catch {
      return false; // its window is open
    }
    fs.rmSync(gone, { recursive: true, force: true });
    return true;
  };
  fs.mkdirSync(p.shells, { recursive: true });
  // The same version already running stays as it is: its files are the same.
  if (!fs.existsSync(target) || discard(target)) fs.cpSync(p.windowsShell, target, { recursive: true });
  for (const entry of fs.readdirSync(p.shells)) {
    if (entry !== version) discard(path.join(p.shells, entry));
  }
  return path.join(target, "KB25.exe");
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
    console.log("Couldn't read the Claude app's settings file, so Crescent wasn't connected to it.");
    return;
  }
  const entry = { command: p.node, args: [p.mcp] };
  if (JSON.stringify(config.mcpServers?.kb25) === JSON.stringify(entry)) {
    console.log("The Claude app is already connected to Crescent.");
    return;
  }
  if (!(await ask("Connect Crescent to the Claude app?"))) return;
  config.mcpServers = { ...config.mcpServers, kb25: entry };
  fs.mkdirSync(CLAUDE_DESKTOP_DIR, { recursive: true });
  fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  console.log("Connected. Quit and reopen the Claude app to use Crescent there.");
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
    console.log("Claude Code is already connected to Crescent.");
  } else {
    if (!(await ask("Connect Crescent to Claude Code?"))) return;
    if (claude(["mcp", "add", "--scope", "user", "kb25", "--", p.node, p.mcp]) === null) {
      console.log("Claude Code didn't accept the connection, so it was skipped.");
      return;
    }
    console.log("Connected. Start a new Claude Code session to use Crescent there.");
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
  await closeWindow();
  await stopServer(p);
  if (isMac) [MAC_APP, OLD_MAC_APP].forEach(removeMacApp);
  if (isWindows) [START_MENU_LINK, OLD_START_MENU_LINK].forEach((link) => fs.rmSync(link, { force: true }));
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
  console.log(`Crescent is removed.${kbDir ? ` Your pages are still in ${tildify(kbDir)}.` : ""}`);
}
