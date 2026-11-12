import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  components,
  isLicenseFile,
  nugetPackages,
  packagesInSourceMap,
  releaseComponents,
  renderNotices,
  type Component,
} from "./third-party-notices.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The notices for this checkout's release, bundled the way build-release.mjs bundles it. */
async function release(): Promise<Component[]> {
  const metafiles = [];
  for (const entry of ["server.ts", "mcp.ts"]) {
    const result = await build({
      entryPoints: [path.join(appDir, "src", entry)],
      outfile: path.join(appDir, "notices-test.mjs"),
      absWorkingDir: appDir,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    metafiles.push(result.metafile);
  }
  return releaseComponents({ appDir, metafiles });
}

const shipped = release();
shipped.catch(() => {}); // each test that awaits it reports a failure

/** Licenses an Apache-2.0 program can ship others' code under, with the notices. */
const COMPATIBLE = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
]);

function compatible(expression: string): boolean {
  // "(MPL-2.0 OR Apache-2.0)" can be taken under either; nothing ships under AND.
  return expression
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/)
    .some((license) => COMPATIBLE.has(license.trim()));
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb25-notices-"));
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("the release's notices name what it bundles, copies and carries inside mermaid", async () => {
  const names = (await shipped).map((entry) => entry.name);
  for (const name of [
    // bundled into server.mjs and mcp.mjs
    "fastify",
    "markdown-it",
    "highlight.js",
    "@modelcontextprotocol/sdk",
    "zod",
    // copied as they are
    "mermaid",
    "katex",
    "@elmir-mamedov/feedback",
    // inside mermaid.min.js, and inside the parser it carries
    "d3",
    "dompurify",
    "@mermaid-js/parser",
    "chevrotain",
    "langium",
    "vscode-uri",
  ]) {
    assert.ok(names.includes(name), `the notices leave out ${name}`);
  }
  for (const entry of await shipped) {
    assert.ok(entry.texts.length > 0, `${entry.name} has no license text`);
    assert.ok(entry.versions.length > 0, `${entry.name} has no version`);
  }
});

test("the release ships nothing under a license Crescent cannot carry", async () => {
  for (const entry of await shipped) {
    assert.ok(entry.license, `${entry.name} names no license`);
    assert.ok(compatible(entry.license), `${entry.name} is under ${entry.license}`);
  }
});

test("app/licenses keeps only license files the release uses", async () => {
  const vendored = path.join(appDir, "licenses");
  const used = new Set((await shipped).flatMap((entry) => entry.dirs));
  const folders = fs
    .readdirSync(vendored, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      entry.name.startsWith("@")
        ? fs.readdirSync(path.join(vendored, entry.name)).map((name) => path.join(vendored, entry.name, name))
        : [path.join(vendored, entry.name)]
    );
  assert.ok(folders.length > 0);
  for (const folder of folders) {
    assert.ok(used.has(folder), `${path.relative(appDir, folder)} is no longer shipped: delete it`);
  }
});

test("a shipped package without a license file stops the notices", () => {
  const dir = tempDir();
  try {
    const nodeModules = path.join(dir, "node_modules");
    write(path.join(nodeModules, "bare", "package.json"), JSON.stringify({ name: "bare", version: "1.0.0" }));
    write(path.join(nodeModules, "fine", "package.json"), JSON.stringify({ name: "fine", version: "2.0.0", license: "MIT" }));
    write(path.join(nodeModules, "fine", "LICENSE"), "MIT License\r\n\r\nCopyright (c) Fine\r\n");
    const places = { nodeModules, vendored: path.join(dir, "licenses") };
    assert.throws(() => components([{ name: "fine" }, { name: "bare" }], places), /bare has no license file/);
    // app/licenses/<name>/ fills in for one that npm installed without it.
    write(path.join(dir, "licenses", "bare", "LICENSE"), "ISC License\n");
    const list = components([{ name: "fine" }, { name: "bare" }, { name: "fine", version: "1.5.0" }], places);
    assert.deepEqual(
      list.map(({ name, versions, texts }) => ({ name, versions, texts })),
      [
        { name: "bare", versions: ["1.0.0"], texts: ["ISC License"] },
        { name: "fine", versions: ["1.5.0", "2.0.0"], texts: ["MIT License\n\nCopyright (c) Fine"] },
      ]
    );
    // Versions of one package under different licenses are listed apart.
    const older = path.join(nodeModules, "host", "node_modules", "fine");
    write(path.join(older, "package.json"), JSON.stringify({ name: "fine", version: "1.0.0", license: "BSD-3-Clause" }));
    write(path.join(older, "LICENSE"), "BSD 3-Clause License");
    assert.deepEqual(
      components([{ name: "fine" }, { name: "fine", dir: older }], places).map(({ versions, license }) => ({ versions, license })),
      [
        { versions: ["1.0.0"], license: "BSD-3-Clause" },
        { versions: ["2.0.0"], license: "MIT" },
      ]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a source map's packages come with the versions bundled, through the maps of prebuilt files", () => {
  const dir = tempDir();
  try {
    const nodeModules = path.join(dir, "node_modules");
    const owner = path.join(nodeModules, "mermaid");
    const map = (sources: string[]) => JSON.stringify({ version: 3, sources, mappings: "" });
    write(
      path.join(owner, "dist", "bundle.js.map"),
      map([
        "../src/own.ts",
        "../../../node_modules/.pnpm/d3-array@3.2.4/node_modules/d3-array/src/index.js",
        "../../../node_modules/.pnpm/@braintree+sanitize-url@7.1.2/node_modules/@braintree/sanitize-url/dist/index.js",
        "../../parser/dist/core.mjs",
      ])
    );
    write(
      path.join(nodeModules, "@mermaid-js", "parser", "dist", "core.mjs.map"),
      map(["../src/grammar.ts", "../../../node_modules/.pnpm/chevrotain@11.1.2/node_modules/chevrotain/lib/api.js", "webpack://LIB/src/uri.ts"])
    );
    assert.deepEqual(packagesInSourceMap(path.join(owner, "dist", "bundle.js.map"), owner, nodeModules), [
      { name: "d3-array", version: "3.2.4" },
      { name: "@braintree/sanitize-url", version: "7.1.2" },
      { name: "@mermaid-js/parser" },
      { name: "chevrotain", version: "11.1.2" },
      { name: "vscode-uri" },
    ]);
    // A source outside the package that names no package is not passed over.
    write(path.join(owner, "dist", "odd.js.map"), map(["../../elsewhere/thing.js"]));
    assert.throws(
      () => packagesInSourceMap(path.join(owner, "dist", "odd.js.map"), owner, nodeModules),
      /lists \.\.\/\.\.\/elsewhere\/thing\.js, which belongs to no package/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the Windows window's NuGet packages are the ones that ship next to KB25.exe", () => {
  const dir = tempDir();
  try {
    const packages = path.join(dir, "nuget");
    const webview = path.join(packages, "microsoft.web.webview2", "1.0.1");
    write(path.join(webview, "LICENSE.txt"), "Copyright (C) Microsoft Corporation.");
    write(path.join(webview, "NOTICE.txt"), "NOTICES AND INFORMATION");
    write(path.join(webview, "microsoft.web.webview2.nuspec"), '<package><metadata><version>1.0.1</version><license type="file">LICENSE.txt</license></metadata></package>');
    const assets = path.join(dir, "project.assets.json");
    write(
      assets,
      JSON.stringify({
        targets: {
          ".NETFramework,Version=v4.8": {
            "Microsoft.NETFramework.ReferenceAssemblies/1.0.3": { type: "package", build: {} },
            "Microsoft.Web.WebView2/1.0.1": { type: "package", runtime: { "lib/Core.dll": {} } },
          },
        },
        libraries: {
          "Microsoft.NETFramework.ReferenceAssemblies/1.0.3": { path: "microsoft.netframework.referenceassemblies/1.0.3" },
          "Microsoft.Web.WebView2/1.0.1": { path: "microsoft.web.webview2/1.0.1" },
        },
        packageFolders: { [packages]: {} },
      })
    );
    const shippedNuget = nugetPackages(assets);
    assert.deepEqual(shippedNuget, [{ name: "Microsoft.Web.WebView2", version: "1.0.1", dir: webview }]);
    const text = renderNotices(components(shippedNuget, { nodeModules: dir, vendored: dir }));
    assert.match(text, /^THIRD-PARTY SOFTWARE NOTICES\n/);
    assert.match(text, /\n {2}Microsoft\.Web\.WebView2 1\.0\.1\n/);
    assert.match(
      text,
      /\n={80}\nMicrosoft\.Web\.WebView2 1\.0\.1\n={80}\n\nCopyright \(C\) Microsoft Corporation\.\n\n-{80}\n\nNOTICES AND INFORMATION\n$/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("license and notice files are told from scripts that share their names", () => {
  for (const file of ["LICENSE", "license", "LICENSE.md", "License.txt", "LICENSE-MPL", "LICENSE_MIT", "LICENCE", "COPYING", "NOTICE.txt", "thirdpartynotices.txt"]) {
    assert.ok(isLicenseFile(file), file);
  }
  for (const file of ["license-update.mjs", "license.json", "licensed.txt", "README.md", "package.json"]) {
    assert.ok(!isLicenseFile(file), file);
  }
});
