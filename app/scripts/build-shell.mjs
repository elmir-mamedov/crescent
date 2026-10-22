// Builds KB25's native windows, the apps that hold KB25 instead of a browser
// tab (shell/):
//   shell/build/mac/KB25     one macOS binary for Apple silicon and Intel,
//                            built with swiftc (Xcode or its Command Line Tools)
//   shell/build/windows/     KB25.exe and the WebView2 libraries, built with the
//                            .NET SDK, which builds it on any system
//
// Each is built where its tools are; the other is skipped, so CI can build
// each on its own system. `--require mac,windows` fails instead, for the
// release, which ships both. DOTNET names the dotnet to use.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(appDir, "shell", "build");

/** Whether `command --version` runs. */
function has(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Build shell/build/mac/KB25 and return its path, or null without the tools. */
export function buildMacShell() {
  if (process.platform !== "darwin" || !has("swiftc")) return null;
  const dir = path.join(out, "mac");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(appDir, "shell", "mac", "KB25.swift");
  const slices = ["arm64", "x86_64"].map((arch) => {
    const file = path.join(dir, `KB25-${arch}`);
    execFileSync("swiftc", ["-O", "-swift-version", "5", "-target", `${arch}-apple-macos13`, "-o", file, source], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    return file;
  });
  const binary = path.join(dir, "KB25");
  execFileSync("lipo", ["-create", ...slices, "-output", binary]);
  for (const slice of slices) fs.rmSync(slice);
  return binary;
}

/** Build shell/build/windows/ and return its path, or null without the .NET SDK. */
export function buildWindowsShell() {
  const dotnet = process.env.DOTNET || "dotnet";
  if (!has(dotnet)) return null;
  const dir = path.join(out, "windows");
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync(
    dotnet,
    ["build", path.join(appDir, "shell", "windows", "KB25.csproj"), "-c", "Release", "-o", dir, "--nologo"],
    { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } }
  );
  // The WebView2 package brings its WPF control too; KB25's window is WinForms.
  fs.rmSync(path.join(dir, "Microsoft.Web.WebView2.Wpf.dll"), { force: true });
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf("--require");
  const required = flag >= 0 ? (process.argv[flag + 1] ?? "").split(",") : [];
  const built = { mac: buildMacShell(), windows: buildWindowsShell() };
  for (const [name, result] of Object.entries(built)) {
    if (result) console.log(`Built the ${name} shell: ${path.relative(appDir, result)}`);
    else if (required.includes(name)) {
      console.error(
        name === "mac"
          ? "The mac shell needs macOS with swiftc (xcode-select --install)."
          : "The windows shell needs the .NET SDK (https://dotnet.microsoft.com/download)."
      );
      process.exit(1);
    } else console.log(`Skipped the ${name} shell: its tools are not here.`);
  }
}
