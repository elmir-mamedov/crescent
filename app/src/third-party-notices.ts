// The software by others that a release ships, and the licenses it comes
// under: scripts/build-release.mjs writes them into kb25.zip as
// THIRD_PARTY_NOTICES.txt. MIT, ISC, BSD and Apache-2.0 all ask that every
// copy carry the license and copyright notice, and npm's own license files do
// not travel with what a release ships: esbuild folds packages into
// server.mjs and mcp.mjs, mermaid.min.js carries its own dependencies inside
// it, and KB25.exe ships next to the WebView2 SDK's libraries.
//
// What a release ships, by where it comes from:
//   - the packages esbuild bundles, from its metafile;
//   - the packages build-release.mjs copies as they are (COPIED);
//   - the packages inside those copies' prebuilt files, from their source maps;
//   - the NuGet packages the Windows window copies next to KB25.exe.
// A license file is looked for in the package's folder under node_modules, then
// in app/licenses/<name>/, which keeps those of packages bundled inside
// another's prebuilt file that npm does not install. A package with neither
// stops the release, so a notice is never left out.
import fs from "node:fs";
import path from "node:path";

/**
 * The packages build-release.mjs copies files of as they are, and the source
 * maps of the prebuilt files among them that bundle other packages. Keep this
 * in step with the copies build-release.mjs makes.
 */
const COPIED: { name: string; maps?: string[] }[] = [
  { name: "mermaid", maps: ["dist/mermaid.min.js.map"] },
  { name: "katex" },
  { name: "@elmir-mamedov/feedback" },
];

/**
 * Sources in a source map whose path names no package, and the package they
 * are. A source this cannot place stops the release, so it gets a look.
 * `inner`, when the source is a prebuilt file of that package, is its path in
 * the package, whose own source map is followed in turn.
 */
const UNNAMED_SOURCES: { pattern: RegExp; name: string; inner?: (match: RegExpExecArray) => string }[] = [
  // @mermaid-js/parser, which mermaid's repository builds in a folder beside it.
  { pattern: /^(?:\.\.\/)+parser\/(.+)$/, name: "@mermaid-js/parser", inner: (match) => match[1] },
  // vscode-uri's webpack build, which langium, inside the parser, imports.
  { pattern: /^webpack:\/\/LIB\//, name: "vscode-uri" },
];

/** A package a release ships, with its folder and version when the place it was found says. */
export interface Shipped {
  name: string;
  dir?: string;
  version?: string;
}

/** One package's entry in the notices. */
export interface Component {
  name: string;
  versions: string[];
  /** Its SPDX license expression, when its package metadata gives one. */
  license?: string;
  /** The folders its license files and license were read from. */
  dirs: string[];
  /** Its license and notice texts, each once. */
  texts: string[];
}

/** The part of an esbuild metafile this reads. */
export interface Metafile {
  inputs: Record<string, unknown>;
}

/** Where packages are looked up by name. */
export interface Places {
  nodeModules: string;
  /** app/licenses: license files for packages that npm does not install. */
  vendored: string;
}

/**
 * Every package a release ships: what the bundles in `metafiles` (built with
 * `absWorkingDir: appDir`) took in, what build-release.mjs copies, and, given
 * the Windows window's obj/project.assets.json, its NuGet packages.
 */
export function releaseComponents(options: {
  appDir: string;
  metafiles: Metafile[];
  nugetAssets?: string;
}): Component[] {
  const places = {
    nodeModules: path.join(options.appDir, "node_modules"),
    vendored: path.join(options.appDir, "licenses"),
  };
  const shipped: Shipped[] = options.metafiles.flatMap((metafile) => bundledPackages(metafile, options.appDir));
  for (const { name, maps = [] } of COPIED) {
    const dir = packageDir(places.nodeModules, name);
    shipped.push({ name, dir });
    for (const map of maps) shipped.push(...packagesInSourceMap(path.join(dir, map), dir, places.nodeModules));
  }
  if (options.nugetAssets) shipped.push(...nugetPackages(options.nugetAssets));
  return components(shipped, places);
}

/** The packages esbuild folded into a bundle, from its metafile, whose paths are relative to `baseDir`. */
export function bundledPackages(metafile: Metafile, baseDir: string): Shipped[] {
  const shipped = new Map<string, Shipped>();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = input.split("/");
    const at = parts.lastIndexOf("node_modules");
    if (at < 0 || at + 1 >= parts.length) continue;
    const name = packageName(parts, at + 1);
    const dir = path.join(baseDir, ...parts.slice(0, at + 1), ...name.split("/"));
    shipped.set(dir, { name, dir });
  }
  return [...shipped.values()];
}

/**
 * The packages a prebuilt file carries inside it, from its source map, `owner`
 * being the folder of the package it belongs to. Prebuilt files of other
 * packages that it took in are followed through their own source maps.
 */
export function packagesInSourceMap(mapFile: string, owner: string, nodeModules: string): Shipped[] {
  const found: Shipped[] = [];
  const walk = (file: string, ownerDir: string) => {
    const map = JSON.parse(fs.readFileSync(file, "utf8")) as { sources: string[]; sourceRoot?: string };
    for (const listed of map.sources) {
      const source = (map.sourceRoot ?? "") + listed;
      const parts = source.split("/");
      const at = parts.lastIndexOf("node_modules");
      if (at >= 0 && at + 1 < parts.length) {
        const name = packageName(parts, at + 1);
        found.push({ name, version: pnpmVersion(parts, at, name) });
        continue;
      }
      const unnamed = UNNAMED_SOURCES.map((entry) => ({ entry, match: entry.pattern.exec(source) })).find(
        ({ match }) => match
      );
      if (unnamed?.match) {
        const { name, inner } = unnamed.entry;
        found.push({ name });
        if (inner) {
          const dir = packageDir(nodeModules, name);
          const innerMap = path.join(dir, ...inner(unnamed.match).split("/")) + ".map";
          if (!fs.existsSync(innerMap)) {
            throw new Error(`${file} takes in ${source}, but there is no ${innerMap} to see what it carries.`);
          }
          walk(innerMap, dir);
        }
        continue;
      }
      // The package's own code.
      if (!/^[a-z][\w+.-]*:/i.test(source) && isInside(path.resolve(path.dirname(file), source), ownerDir)) continue;
      throw new Error(
        `${file} lists ${source}, which belongs to no package this can name: add it to UNNAMED_SOURCES in src/third-party-notices.ts.`
      );
    }
  };
  walk(mapFile, owner);
  return found;
}

/** The NuGet packages a .NET build copies next to its program, from its obj/project.assets.json. */
export function nugetPackages(assetsFile: string): Shipped[] {
  type Entry = { type?: string; runtime?: object; runtimeTargets?: object; native?: object };
  if (!fs.existsSync(assetsFile)) throw new Error(`No ${assetsFile}: build the Windows window first.`);
  const assets = JSON.parse(fs.readFileSync(assetsFile, "utf8")) as {
    targets: Record<string, Record<string, Entry>>;
    libraries: Record<string, { path: string }>;
    packageFolders?: Record<string, unknown>;
  };
  const folders = Object.keys(assets.packageFolders ?? {});
  const shipped = new Map<string, Shipped>();
  for (const target of Object.values(assets.targets)) {
    for (const [key, entry] of Object.entries(target)) {
      // A package that only builds (reference assemblies, say) ships nothing.
      if (entry.type !== "package" || !(entry.runtime || entry.runtimeTargets || entry.native)) continue;
      const library = assets.libraries[key];
      const dir = folders.map((folder) => path.join(folder, library.path)).find((candidate) => fs.existsSync(candidate));
      if (!dir) throw new Error(`${assetsFile} names ${key}, which is in none of ${folders.join(", ")}.`);
      const [name, version] = key.split("/");
      shipped.set(key, { name, version, dir });
    }
  }
  return [...shipped.values()];
}

/**
 * Each package once, with every version shipped and its license texts, or
 * once per license when its versions differ in that; a package without a
 * license file throws.
 */
export function components(shipped: Shipped[], places: Places): Component[] {
  const byName = new Map<string, Component>();
  for (const item of shipped) {
    const dir = item.dir ?? locate(item.name, places);
    const vendored = packageDir(places.vendored, item.name);
    const meta = readMeta(dir);
    const read = [dir];
    let files = licenseFiles(dir);
    if (!files.length) {
      files = licenseFiles(vendored);
      read.push(vendored);
    }
    if (!files.length) {
      throw new Error(
        `${item.name} has no license file in ${dir}: put its license and notice files in app/licenses/${item.name}/.`
      );
    }
    // A package.json without a license field gets it from app/licenses/<name>/package.json.
    let license = meta.license;
    if (!license) {
      license = readMeta(vendored).license;
      read.push(vendored);
    }
    const key = `${item.name}\n${license ?? ""}`;
    let entry = byName.get(key);
    if (!entry) {
      entry = { name: item.name, versions: [], license, dirs: [], texts: [] };
      byName.set(key, entry);
    }
    const version = item.version ?? meta.version;
    if (version && !entry.versions.includes(version)) entry.versions.push(version);
    for (const folder of read) if (fs.existsSync(folder) && !entry.dirs.includes(folder)) entry.dirs.push(folder);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
      if (text && !entry.texts.includes(text)) entry.texts.push(text);
    }
  }
  for (const entry of byName.values()) entry.versions.sort(compareVersions);
  return [...byName.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || compareVersions(a.versions[0] ?? "", b.versions[0] ?? "")
  );
}

/** THIRD_PARTY_NOTICES.txt. */
export function renderNotices(list: Component[]): string {
  const title = (entry: Component) => `${entry.name} ${entry.versions.join(", ")}`.trim();
  // "(MPL-2.0 OR Apache-2.0)" reads as MPL-2.0 OR Apache-2.0 inside the list's own brackets.
  const license = (entry: Component) => entry.license?.replace(/^\((.*)\)$/, "$1");
  const rule = "=".repeat(80);
  const head = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "Crescent includes the software listed below, which others wrote. Each is",
    "named with the versions Crescent ships and the license it is under, and the",
    "text of that license, with any notices that come with it, follows.",
    "",
    "Crescent itself is licensed under the Apache License 2.0; see LICENSE and",
    "NOTICE.",
    "",
    ...list.map((entry) => `  ${title(entry)}${entry.license ? ` (${license(entry)})` : ""}`),
  ].join("\n");
  const sections = list.map((entry) =>
    [
      rule,
      title(entry),
      ...(entry.license ? [`License: ${license(entry)}`] : []),
      rule,
      "",
      entry.texts.join(`\n\n${"-".repeat(80)}\n\n`),
    ].join("\n")
  );
  return `${[head, ...sections].join("\n\n\n")}\n`;
}

/** License and notice files: LICENSE, LICENSE-MPL, License.txt, COPYING, NOTICE.txt, thirdpartynotices.txt. */
export function isLicenseFile(file: string): boolean {
  return /^(licen[cs]es?|copying|notices?|third-?party-?notices)(?![a-z])/i.test(file) && !/\.([cm]?[jt]s|json)$/i.test(file);
}

function licenseFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const notice = (file: string) => /notice/i.test(file);
  return entries
    .filter((entry) => entry.isFile() && isLicenseFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(notice(a)) - Number(notice(b)) || a.localeCompare(b, "en"))
    .map((file) => path.join(dir, file));
}

function locate(name: string, places: Places): string {
  const installed = packageDir(places.nodeModules, name);
  return fs.existsSync(path.join(installed, "package.json")) ? installed : packageDir(places.vendored, name);
}

function packageDir(root: string, name: string): string {
  return path.join(root, ...name.split("/"));
}

/** The package named at parts[at], with its scope if it has one. */
function packageName(parts: string[], at: number): string {
  return parts[at].startsWith("@") ? `${parts[at]}/${parts[at + 1]}` : parts[at];
}

/** The version in a pnpm path (node_modules/.pnpm/<name>@<version>_<peers>/node_modules/<name>/…). */
function pnpmVersion(parts: string[], at: number, name: string): string | undefined {
  if (parts[at - 2] !== ".pnpm") return undefined;
  const folder = parts[at - 1].split("_")[0];
  const sign = folder.lastIndexOf("@");
  if (sign <= 0 || folder.slice(0, sign).replace("+", "/") !== name) return undefined;
  return folder.slice(sign + 1);
}

function readMeta(dir: string): { version?: string; license?: string } {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return { version: pkg.version, license: spdx(pkg.license ?? pkg.licenses) };
  } catch {
    // A NuGet package keeps its metadata in a .nuspec instead.
  }
  try {
    const nuspec = fs.readdirSync(dir).find((file) => file.endsWith(".nuspec"));
    if (!nuspec) return {};
    const xml = fs.readFileSync(path.join(dir, nuspec), "utf8");
    return {
      version: /<version>([^<]+)<\/version>/.exec(xml)?.[1],
      license: /<license\s+type="expression"\s*>([^<]+)<\/license>/.exec(xml)?.[1],
    };
  } catch {
    return {};
  }
}

/** package.json's license, in any of the shapes npm has accepted. */
function spdx(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(spdx).filter(Boolean).join(" OR ") || undefined;
  if (value && typeof value === "object" && "type" in value) return spdx(value.type);
  return undefined;
}

function isInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}
