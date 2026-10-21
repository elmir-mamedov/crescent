// Opens KB25: starts the server when nothing answers on its port, then opens
// KB25's own window (window.mjs), which stops the server again when it is
// closed. The macOS KB25.app and the Windows Start-menu shortcut both run this
// with KB25's private Node. The server outlives this script and runs in desktop
// mode (KB25_DESKTOP), which gives a page opened in an ordinary browser tab a
// Quit button.
//
// KB25_NO_BROWSER=1 starts the server without opening a window (CI smoke tests,
// and the restart after an update, whose window is still open).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { alertUser, isMac, isUp, paths, serverUrl, sleep } from "./common.mjs";
import { openWindow } from "./window.mjs";

const p = paths();
const url = serverUrl(p);

if (!(await isUp(url))) {
  const env = { ...process.env, KB25_DESKTOP: "1" };
  // Finder hands apps a bare PATH; the server looks for git, which may be
  // Homebrew's.
  if (isMac) env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH ?? "/usr/bin:/bin"}`;

  const log = fs.openSync(p.logFile, "a");
  const server = spawn(p.node, [p.server], {
    cwd: p.home, // never inside app/, which an update replaces
    env,
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  // No server.pid here: the server writes it once it holds the port, so a
  // second launch's server, which loses the port, never replaces it.
  server.unref();

  const deadline = Date.now() + 20_000;
  while (!(await isUp(url))) {
    if (Date.now() > deadline || server.exitCode !== null) {
      alertUser(`KB25 did not start. Details are in ${path.join(p.home, "kb25.log")}`);
      process.exit(1);
    }
    await sleep(250);
  }
}

if (!process.env.KB25_NO_BROWSER) openWindow({ node: p.node, url, stateDir: p.home, logFile: p.logFile });
