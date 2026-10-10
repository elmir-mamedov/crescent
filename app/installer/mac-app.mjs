// Builds a minimal macOS .app bundle around a shell script, with the viewer's
// favicon as its icon, so Spotlight, Launchpad and the Dock treat it like any
// other app. Shared by the developer launcher (scripts/install-app.mjs) and the
// one-line installer (installer/setup.mjs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/**
 * (Re)write `bundle` (e.g. ~/Applications/KB25.app) so that opening it runs
 * `script`. `iconPng` is a square PNG, 512px or larger.
 */
export function writeMacApp({ bundle, script, iconPng }) {
  fs.rmSync(bundle, { recursive: true, force: true });
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "Contents", "Info.plist"), INFO_PLIST);
  fs.writeFileSync(path.join(bundle, "Contents", "MacOS", "KB25"), script, { mode: 0o755 });
  writeIcon(iconPng, path.join(bundle, "Contents", "Resources", "AppIcon.icns"));
  // Have Finder, the Dock and Spotlight pick up the rebuilt bundle and its icon.
  execFileSync(LSREGISTER, ["-f", bundle]);
}

/** Remove a bundle written by {@link writeMacApp} and forget it in LaunchServices. */
export function removeMacApp(bundle) {
  if (!fs.existsSync(bundle)) return;
  try {
    execFileSync(LSREGISTER, ["-u", bundle], { stdio: "ignore" });
  } catch {}
  fs.rmSync(bundle, { recursive: true, force: true });
}

/** Single-quote a value for /bin/sh. */
export function sh(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>KB25</string>
  <key>CFBundleDisplayName</key><string>KB25</string>
  <key>CFBundleIdentifier</key><string>local.kb25.viewer</string>
  <key>CFBundleExecutable</key><string>KB25</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;

/** Build an .icns from a PNG with the stock sips and iconutil. */
function writeIcon(source, icnsPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb25-icon-"));
  const iconset = path.join(tmp, "AppIcon.iconset");
  fs.mkdirSync(iconset);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = String(size * scale);
        const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
        execFileSync("sips", ["-z", px, px, source, "--out", path.join(iconset, name)], {
          stdio: "ignore",
        });
      }
    }
    fs.mkdirSync(path.dirname(icnsPath), { recursive: true });
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", icnsPath]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
