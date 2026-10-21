// Installs ~/Applications/KB25.app, a launcher for the web viewer that
// Spotlight and Launchpad pick up. Opening it starts the server when it is not
// already running, then opens KB25's own window (installer/window.mjs), which
// stops the server it started when the window closes. A server already running
// from a terminal (npm run dev) is not in desktop mode and keeps running.
//
// This is the developer launcher: it runs this checkout's src/ through tsx.
// Everyone else installs a packaged copy with the one-line installer in the
// root README.md (installer/install.sh, installer/install.ps1).
//
// Re-run after moving the checkout or switching Node versions: the launcher
// records the absolute path of the node binary that installed it, because an
// app started from Finder does not get the shell's PATH (or nvm).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sh, writeMacApp } from "../installer/mac-app.mjs";

if (process.platform !== "darwin") {
  console.error("KB25.app is a macOS launcher; on other systems run `npm start`.");
  process.exit(1);
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(appDir, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsxCli)) {
  console.error("tsx is not installed; run `npm install` first.");
  process.exit(1);
}

const bundle = path.join(os.homedir(), "Applications", "KB25.app");
const logPath = path.join(os.homedir(), "Library", "Logs", "kb25-viewer.log");
// The window's own browser profile; the installed KB25 keeps its own.
const statePath = path.join(os.homedir(), "Library", "Application Support", "KB25 (dev)");
const windowScript = path.join(appDir, "installer", "window.mjs");
const port = process.env.PORT ?? "4000";

const script = `#!/bin/sh
URL="http://localhost:${port}"
LOG=${sh(logPath)}
# The server shells out to git, and Finder hands apps a bare PATH.
export PATH=${sh(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
# Started without a terminal, so closing KB25's window stops it.
export KB25_DESKTOP=1

up() { curl -s -o /dev/null --max-time 1 "$URL/"; }

if ! up; then
  cd ${sh(appDir)} || exit 1
  nohup ${sh(process.execPath)} ${sh(tsxCli)} src/server.ts >>"$LOG" 2>&1 &
  i=0
  until up; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
      osascript -e "display alert \\"KB25 did not start\\" message \\"See $LOG\\"" >/dev/null
      exit 1
    fi
    sleep 0.25
  done
fi

exec ${sh(process.execPath)} ${sh(windowScript)} open "$URL" ${sh(statePath)} "$LOG"
`;

fs.mkdirSync(path.dirname(logPath), { recursive: true });
writeMacApp({ bundle, script, iconPng: path.join(appDir, "public", "favicon-512x512.png") });
console.log(`Installed ${bundle}. Open it from Spotlight: Cmd+Space, "KB25".`);
