// Writes Crescent.app: KB25's window on macOS (shell/mac/KB25.swift, built by
// scripts/build-shell.mjs) in a bundle with the viewer's favicon as its icon,
// so Spotlight, Launchpad, the Dock and Cmd+Tab treat KB25 like any other app.
// Shared by the developer launcher (scripts/install-app.mjs) and the one-line
// installer (installer/setup.mjs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/**
 * (Re)write `bundle` (e.g. ~/Applications/Crescent.app) around `executable`, the
 * built window. `start` is the command it runs to start the server and learn
 * its address (KB25StartCommand); `resources` are extra files for
 * Contents/Resources, such as a script `start` names. `iconPng` is a square
 * PNG, 512px or larger.
 */
export function writeMacApp({ bundle, executable, start, version = "", resources = {}, iconPng }) {
  fs.rmSync(bundle, { recursive: true, force: true });
  const contents = path.join(bundle, "Contents");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(contents, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(contents, "Info.plist"), infoPlist({ start, version }));
  fs.copyFileSync(executable, path.join(contents, "MacOS", "KB25"));
  fs.chmodSync(path.join(contents, "MacOS", "KB25"), 0o755);
  for (const [name, content] of Object.entries(resources)) {
    fs.writeFileSync(path.join(contents, "Resources", name), content, { mode: 0o755 });
  }
  writeIcon(iconPng, path.join(contents, "Resources", "AppIcon.icns"));
  // Signed ad hoc as a whole: Apple silicon runs only signed code, and the
  // signature must cover the Info.plist written here. A release unpacked from
  // a browser download would carry quarantine, which an ad hoc app cannot pass.
  try {
    execFileSync("xattr", ["-dr", "com.apple.quarantine", bundle], { stdio: "ignore" });
  } catch {}
  execFileSync("codesign", ["--force", "--sign", "-", bundle], { stdio: "ignore" });
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

const xml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The bundle's Info.plist. Local networking lets the window load the server
 * on localhost over plain http, which App Transport Security otherwise blocks.
 */
function infoPlist({ start, version }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Crescent</string>
  <key>CFBundleDisplayName</key><string>Crescent</string>
  <key>CFBundleIdentifier</key><string>local.kb25.viewer</string>
  <key>CFBundleExecutable</key><string>KB25</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>CFBundleVersion</key><string>${xml(version || "1")}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>KB25StartCommand</key>
  <array>
${start.map((arg) => `    <string>${xml(arg)}</string>`).join("\n")}
  </array>
</dict>
</plist>
`;
}

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
