// Shared by the installed launcher and the setup wizard. Both run on KB25's
// own private Node, so nothing here may assume anything else is installed.
//
// Installed layout (KB25_HOME):
//   macOS    ~/Library/Application Support/KB25
//   Windows  %LOCALAPPDATA%\KB25
//
//   node/          private Node.js, fetched by install.sh / install.ps1
//   app/           the release (server/, public/, installer/, shell/, …), replaced
//                  on update
//   shell/<ver>/   KB25.exe, KB25's window on Windows, copied out of app/: Windows
//                  locks a running program's files, and an update replaces app/
//                  while the window is open
//   webview/       the Windows window's browser data (cookies, localStorage)
//   .env           settings, kept across updates; server.mjs and mcp.mjs read it
//                  as their ../../.env
//   kb25.log       server output
//   server.pid     the running server, so updates and removal can stop it
//
// On macOS the window is ~/Applications/KB25.app itself (mac-app.mjs).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const isMac = process.platform === "darwin";
export const isWindows = process.platform === "win32";

/** KB25_HOME: two levels above this file (app/installer/ or app.new/installer/). */
export function kb25Home() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function paths(home = kb25Home()) {
  const app = path.join(home, "app");
  return {
    home,
    app,
    node: isWindows ? path.join(home, "node", "node.exe") : path.join(home, "node", "bin", "node"),
    server: path.join(app, "server", "server.mjs"),
    mcp: path.join(app, "server", "mcp.mjs"),
    launcher: path.join(app, "installer", "launcher.mjs"),
    macShell: path.join(app, "shell", "mac", "KB25"),
    windowsShell: path.join(app, "shell", "windows"),
    shells: path.join(home, "shell"),
    envFile: path.join(home, ".env"),
    logFile: path.join(home, "kb25.log"),
    pidFile: path.join(home, "server.pid"),
  };
}

/** KEY=value lines, the same shape the server's loadEnvFile reads. */
export function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

export function serverUrl(p) {
  return `http://localhost:${readEnvFile(p.envFile).PORT || "4000"}`;
}

/** Whether anything answers HTTP at `url`. */
export async function isUp(url) {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop the server the launcher started, if it is still running. */
export async function stopServer(p) {
  let pid;
  try {
    pid = Number(fs.readFileSync(p.pidFile, "utf8").trim());
  } catch {
    return;
  }
  try {
    process.kill(pid);
    for (let waited = 0; waited < 5000; waited += 100) {
      process.kill(pid, 0); // throws once the process is gone
      await sleep(100);
    }
  } catch {}
  fs.rmSync(p.pidFile, { force: true });
}

/** Open `url` in the default browser. */
export function openUrl(url) {
  const [cmd, args] = isMac
    ? ["open", [url]]
    : isWindows
      ? ["cmd.exe", ["/d", "/c", "start", "", url]] // "" is start's window title
      : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Tell the user something went wrong, in a dialog: a launcher has no terminal. */
export function alertUser(message) {
  console.error(message);
  try {
    if (isMac) {
      execFileSync("osascript", [
        "-e",
        `display alert "KB25" message ${JSON.stringify(message)}`,
      ]);
    } else if (isWindows) {
      powershell(
        `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${psQuote(message)}, 'KB25') | Out-Null`
      );
    }
  } catch {}
}

/** Single-quote a value for PowerShell. */
export function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** A script as PowerShell's -EncodedCommand wants it, which sidesteps all command-line quoting. */
export function psEncode(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Run a PowerShell script and wait for it. */
export function powershell(script) {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", psEncode(script)],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );
}

/** Shorten a path under the home folder to ~/… for display. */
export function tildify(p) {
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}
