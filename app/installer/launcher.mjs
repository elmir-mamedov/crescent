// Starts KB25's server when nothing answers on its port, and prints the
// server's address. KB25's window runs this (KB25.app on macOS, KB25.exe on
// Windows; see shell/) with KB25's private Node, and opens the address. The
// server outlives this script and runs in desktop mode (KB25_DESKTOP), which
// lets the window stop it again when it closes.
//
// KB25_NO_BROWSER=1, which the windows set, only starts the server. Without it,
// the address also opens in the default browser, for this script run by hand.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { alertUser, isMac, isUp, openUrl, paths, serverUrl, sleep } from "./common.mjs";

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
      alertUser(`Crescent did not start. Details are in ${path.join(p.home, "kb25.log")}`);
      process.exit(1);
    }
    await sleep(250);
  }
}

console.log(url);
if (!process.env.KB25_NO_BROWSER) openUrl(url);
