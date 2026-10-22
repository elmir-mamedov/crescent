// Builds what the one-line installer downloads: dist/kb25.zip, plus copies of
// installer/install.sh and installer/install.ps1 to publish next to it, and
// dist/VERSION, which installed copies read to learn a newer release is out.
// The release workflow runs this on a version tag and attaches all four to a
// GitHub Release.
//
// KB25's windows (shell/) are built here too, both of them, so a release is
// built on macOS with swiftc and the .NET SDK (DOTNET names one elsewhere).
//
// The zip needs nothing but Node to run: the server and the MCP server are
// each bundled into one file, laid out so the paths server.ts already uses
// (../public, ../node_modules/mermaid/dist, ../node_modules/katex/dist,
// ../node_modules/@elmir-mamedov/feedback/dist, ../../.env) resolve unchanged.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildMacShell, buildWindowsShell } from "./build-shell.mjs";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(appDir, "..", "dist");
const out = path.join(distDir, "release");
const { version } = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));

for (const stale of ["release", "kb25.zip", "install.sh", "install.ps1", "VERSION"]) {
  fs.rmSync(path.join(distDir, stale), { recursive: true, force: true });
}

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // CommonJS dependencies call require(), which an ES module does not have.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "warning",
};
await build({
  ...common,
  entryPoints: [path.join(appDir, "src", "server.ts")],
  outfile: path.join(out, "server", "server.mjs"),
});
await build({
  ...common,
  entryPoints: [path.join(appDir, "src", "mcp.ts")],
  outfile: path.join(out, "server", "mcp.mjs"),
  // The MCP server never renders HTML, so it needs no highlighting languages.
  alias: { "highlight.js": "highlight.js/lib/core" },
});

const copy = (from, to) => fs.cpSync(from, path.join(out, to), { recursive: true });
copy(path.join(appDir, "public"), "public");
// The only Mermaid file the viewer serves (views.ts loads /_vendor/mermaid/mermaid.min.js).
copy(
  path.join(appDir, "node_modules", "mermaid", "dist", "mermaid.min.js"),
  path.join("node_modules", "mermaid", "dist", "mermaid.min.js")
);
// KaTeX's stylesheet and fonts (views.ts links /_vendor/katex/katex.min.css).
// woff2 only: every browser the viewer supports reads it, and it is the first
// source the stylesheet lists, so the woff and ttf copies would never load.
copy(
  path.join(appDir, "node_modules", "katex", "dist", "katex.min.css"),
  path.join("node_modules", "katex", "dist", "katex.min.css")
);
for (const font of fs.readdirSync(path.join(appDir, "node_modules", "katex", "dist", "fonts"))) {
  if (!font.endsWith(".woff2")) continue;
  copy(
    path.join(appDir, "node_modules", "katex", "dist", "fonts", font),
    path.join("node_modules", "katex", "dist", "fonts", font)
  );
}
// The feedback dialog's browser modules (views.ts loads /_vendor/feedback/...).
copy(
  path.join(appDir, "node_modules", "@elmir-mamedov", "feedback", "dist"),
  path.join("node_modules", "@elmir-mamedov", "feedback", "dist")
);
for (const file of ["common.mjs", "launcher.mjs", "mac-app.mjs", "setup.mjs"]) {
  copy(path.join(appDir, "installer", file), path.join("installer", file));
}
const macShell = buildMacShell();
const windowsShell = buildWindowsShell();
if (!macShell || !windowsShell) {
  console.error("A release ships both of KB25's windows: build it on macOS, with swiftc and the .NET SDK.");
  process.exit(1);
}
copy(macShell, path.join("shell", "mac", "KB25"));
copy(windowsShell, path.join("shell", "windows"));
copy(path.join(appDir, "..", "kb25-plugin", "skills"), "skills");
fs.writeFileSync(path.join(out, "VERSION"), `${version}\n`);

execFileSync("zip", ["-r", "-q", "-X", path.join(distDir, "kb25.zip"), ".", "-x", "*.DS_Store"], {
  cwd: out,
});
for (const file of ["install.sh", "install.ps1"]) {
  fs.copyFileSync(path.join(appDir, "installer", file), path.join(distDir, file));
}
fs.writeFileSync(path.join(distDir, "VERSION"), `${version}\n`);
console.log(`Built dist/kb25.zip (KB25 ${version}) with install.sh, install.ps1 and VERSION.`);
