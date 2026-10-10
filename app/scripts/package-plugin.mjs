// Zips the kb25 plugin into dist/kb25-<version>.zip, the file handed to people
// who install it (e.g. in Cowork). Run through `npm run package:plugin`, which
// rebuilds the bundled server first — the bundle is not tracked in git, so a
// zip is the only place a fresh copy of it travels.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pluginDir = path.join(repoDir, "kb25-plugin");

if (!fs.existsSync(path.join(pluginDir, "server", "mcp.mjs"))) {
  console.error("kb25-plugin/server/mcp.mjs is missing; run `npm run build:plugin` first.");
  process.exit(1);
}

const { version } = JSON.parse(
  fs.readFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")
);
const outFile = path.join(repoDir, "dist", `kb25-${version}.zip`);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.rmSync(outFile, { force: true });
// Zipped from inside the plugin folder so .claude-plugin/ sits at the zip root.
execFileSync("zip", ["-r", "-q", "-X", outFile, ".", "-x", "*.DS_Store"], {
  cwd: pluginDir,
  stdio: "inherit",
});
console.log(`Packaged ${path.relative(repoDir, outFile)}`);
