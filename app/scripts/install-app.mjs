// Installs ~/Applications/KB25.app, a launcher for the web viewer that
// Spotlight and Launchpad pick up. Opening it starts the server when it is not
// already running, then shows the viewer in its own window (Edge or Chrome in
// app mode, else the default browser). The server keeps running after the
// window closes, so the next launch is instant; it stops at logout.
//
// Re-run after moving the checkout or switching Node versions: the launcher
// records the absolute path of the node binary that installed it, because an
// app started from Finder does not get the shell's PATH (or nvm).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const port = process.env.PORT ?? "4000";

const launcher = `#!/bin/sh
URL="http://localhost:${port}"
LOG=${sh(logPath)}
# The server shells out to git, and Finder hands apps a bare PATH.
export PATH=${sh(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

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

for browser in "Microsoft Edge" "Google Chrome"; do
  if [ -d "/Applications/$browser.app" ]; then
    exec open -na "$browser" --args --app="$URL"
  fi
done
exec open "$URL"
`;

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>KB25</string>
  <key>CFBundleDisplayName</key><string>KB25</string>
  <key>CFBundleIdentifier</key><string>local.kb25.viewer</string>
  <key>CFBundleExecutable</key><string>KB25</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;

fs.rmSync(bundle, { recursive: true, force: true });
fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(path.join(bundle, "Contents", "Info.plist"), infoPlist);
fs.writeFileSync(path.join(bundle, "Contents", "MacOS", "KB25"), launcher, { mode: 0o755 });
console.log(`Installed ${bundle}. Open it from Spotlight: Cmd+Space, "KB25".`);

/** Single-quote a value for /bin/sh. */
function sh(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
