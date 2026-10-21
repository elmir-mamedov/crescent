// KB25's window: Chrome or Edge in app mode (no tabs, no address bar) on a
// profile of KB25's own, so KB25 opens and closes like an app instead of a
// browser tab. A watcher holds that browser over its DevTools pipe and sees
// each window open and close. Once the last window closes, or the browser
// quits (Cmd+Q), the watcher closes the browser and stops the server. The pipe
// ties the two together the other way too: if the watcher dies, the browser
// exits, so no KB25 window is ever left without one.
//
//   node window.mjs open <serverUrl> <stateDir> <logFile>
//       What the launchers run. Opens a window and returns at once: a running
//       watcher's browser opens one more, otherwise a new watcher starts.
//   node window.mjs watch <serverUrl> <stateDir> [windowUrl]
//       The watcher. windowUrl, the page the window opens on, defaults to the
//       server; the release smoke test points it at a page that closes itself.
//
// <stateDir> holds the profile (window/), window.json (the watcher's pid and
// its browser) and server.pid, which stopping falls back on. KB25_BROWSER
// names a browser to use first; KB25_BROWSER_ARGS adds switches (the smoke
// test's --headless=new). Without Chrome or Edge, KB25 opens in the default
// browser instead and runs until its Quit button.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openUrl, paths, sleep, stopServer } from "./common.mjs";

const thisFile = fileURLToPath(import.meta.url);

/** Where each supported browser installs, in the order KB25 prefers them. */
export function browserCandidates(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === "darwin") {
    const apps = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"];
    return apps.flatMap((name) =>
      ["/Applications", path.posix.join(home, "Applications")].map((dir) =>
        path.posix.join(dir, `${name}.app`, "Contents", "MacOS", name)
      )
    );
  }
  if (platform === "win32") {
    // Every Windows has Edge, so Chrome only matters where Edge was removed.
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA ? [env.LOCALAPPDATA] : [];
    return [
      ...[programFilesX86, programFiles].map((dir) =>
        path.win32.join(dir, "Microsoft", "Edge", "Application", "msedge.exe")
      ),
      ...[programFiles, programFilesX86, ...local].map((dir) =>
        path.win32.join(dir, "Google", "Chrome", "Application", "chrome.exe")
      ),
    ];
  }
  return [];
}

/** The browser KB25's window runs in, or null when none is installed. */
export function findBrowser({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  const candidates = browserCandidates(platform, env, home);
  if (env.KB25_BROWSER) candidates.unshift(env.KB25_BROWSER);
  return candidates.find((file) => exists(file)) ?? null;
}

/** The switches that open `url` as an app window on KB25's own profile. */
export function browserArgs(url, profile, extra = []) {
  return [`--app=${url}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...extra];
}

/**
 * Follows DevTools target events and calls `onLastClosed` once the last window
 * has gone. A window is a page target; the browser's own extensions and
 * workers are other types.
 */
export function windowTracker(onLastClosed) {
  const pages = new Set();
  return {
    handle(message) {
      const info = message.params?.targetInfo;
      if (message.method === "Target.targetCreated" && info?.type === "page") {
        pages.add(info.targetId);
      } else if (message.method === "Target.targetDestroyed" && pages.delete(message.params.targetId)) {
        if (pages.size === 0) onLastClosed();
      }
    },
    count: () => pages.size,
  };
}

const profileDir = (stateDir) => path.join(stateDir, "window");
const stateFile = (stateDir) => path.join(stateDir, "window.json");

function readState(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(stateDir), "utf8"));
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Open a KB25 window on `url` and return; see the top of this file. */
export function openWindow({ node = process.execPath, url, stateDir, logFile }) {
  const running = readState(stateDir);
  if (running && isAlive(running.pid) && fs.existsSync(running.browser)) {
    // The running browser takes this over and opens one more window, which its
    // watcher sees like the first.
    spawn(running.browser, browserArgs(url, profileDir(stateDir)), { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (!findBrowser()) {
    openUrl(url);
    return;
  }
  fs.mkdirSync(stateDir, { recursive: true });
  const log = fs.openSync(logFile, "a");
  spawn(node, [thisFile, "watch", url, stateDir], {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  }).unref();
}

/** A DevTools client over the pipe of a browser started with --remote-debugging-pipe. */
function devtools(child, onEvent) {
  const toBrowser = child.stdio[3];
  const fromBrowser = child.stdio[4];
  // A write after the browser has gone fails; its exit is handled on its own.
  toBrowser.on("error", () => {});
  fromBrowser.setEncoding("utf8");
  const pending = new Map();
  let nextId = 0;
  let buffer = "";
  fromBrowser.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else onEvent(message);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      toBrowser.write(`${JSON.stringify({ id, method, params })}\0`);
    });
}

/**
 * Stop the server once the window has closed. The server holds the quit while
 * a chat reply is still being written; one that will not take the request
 * (sign-in on, say) is stopped through its pid file instead. A server that no
 * longer answers is left alone: its pid file may be stale by then, and the
 * pid someone else's.
 */
async function stopKb25(serverUrl, stateDir) {
  try {
    const response = await fetch(`${serverUrl}/_quit?when=idle`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 202) return;
  } catch {
    return;
  }
  await stopServer(paths(stateDir));
}

/** Run the watcher; see the top of this file. */
export async function watch(serverUrl, stateDir, windowUrl = serverUrl) {
  const browser = findBrowser();
  if (!browser) {
    openUrl(windowUrl);
    return;
  }
  const extra = (process.env.KB25_BROWSER_ARGS ?? "").split(" ").filter(Boolean);
  const child = spawn(browser, browserArgs(windowUrl, profileDir(stateDir), ["--remote-debugging-pipe", ...extra]), {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  fs.writeFileSync(stateFile(stateDir), `${JSON.stringify({ pid: process.pid, browser, browserPid: child.pid })}\n`);
  const started = Date.now();
  const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  let opened = false;
  let finished = false;

  const clearState = () => {
    if (readState(stateDir)?.pid === process.pid) fs.rmSync(stateFile(stateDir), { force: true });
  };

  async function finish(reason) {
    if (finished) return;
    finished = true;
    console.log(`KB25 window: ${reason} after ${seconds()}`);
    // A browser on macOS keeps running with no windows; this one has nothing
    // else to do.
    if (child.exitCode === null) await Promise.race([send("Browser.close"), sleep(3000)]);
    if (child.exitCode === null) child.kill();
    await stopKb25(serverUrl, stateDir);
    clearState();
    process.exit(0);
  }

  const tracker = windowTracker(() => void finish("last window closed"));
  const send = devtools(child, (message) => {
    const before = tracker.count();
    tracker.handle(message);
    if (!opened && tracker.count() > 0) {
      opened = true;
      console.log(`KB25 window: open in ${path.basename(browser)} after ${seconds()}`);
    } else if (tracker.count() !== before && tracker.count() > 0) {
      // Logged with the time, so a window that closes by itself shows up here.
      console.log(`KB25 window: ${tracker.count()} open after ${seconds()}`);
    }
  });

  child.on("error", (error) => {
    console.log(`KB25 window: ${browser} did not start (${error.message}); opening the default browser`);
    finished = true;
    clearState();
    openUrl(windowUrl);
    process.exit(0);
  });
  child.on("exit", (code) => {
    if (opened) return void finish("browser quit");
    if (finished) return;
    // It never showed a window. Exit code 0 is the browser handing the request
    // to a copy already running on this profile, which opened the window
    // there; anything else is a failure, and the default browser stands in.
    finished = true;
    clearState();
    if (code === 0) {
      console.log("KB25 window: handed to the KB25 window already open");
    } else {
      console.log(`KB25 window: ${path.basename(browser)} exited with ${code}; opening the default browser`);
      openUrl(windowUrl);
    }
    process.exit(0);
  });

  await send("Target.setDiscoverTargets", { discover: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const [mode, url, stateDir, extra] = process.argv.slice(2);
  if (mode === "open" && url && stateDir && extra) openWindow({ url, stateDir, logFile: extra });
  else if (mode === "watch" && url && stateDir) await watch(url, stateDir, extra);
  else {
    console.error("usage: window.mjs open <serverUrl> <stateDir> <logFile> | watch <serverUrl> <stateDir> [windowUrl]");
    process.exit(2);
  }
}
