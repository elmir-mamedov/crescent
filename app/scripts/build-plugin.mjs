// Bundles the stdio MCP server into the kb25 plugin. An installed plugin is
// copied into the client's plugin cache on its own, without this checkout or
// its node_modules, so the server it starts has to be one self-contained file
// that plain `node` can run.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(appDir, "src", "mcp.ts")],
  outfile: path.join(appDir, "..", "kb25-plugin", "server", "mcp.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // The server only parses Markdown; highlighting runs when HTML is rendered,
  // which is the web viewer's job. markdown.ts checks getLanguage() before it
  // highlights, so the core build (no languages) is safe and saves ~1.6 MB.
  alias: { "highlight.js": "highlight.js/lib/core" },
  // CommonJS dependencies (gray-matter, highlight.js) call require(), which an
  // ES module does not have.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "info",
});
