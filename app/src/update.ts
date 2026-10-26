import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * In-app updates for an installed copy. The check reads the VERSION file every
 * GitHub Release publishes; the update itself re-runs that release's own
 * installer unattended (KB25_UPDATE=1), so there is one update path, the one
 * release CI installs for real, and its fixes ship with the release that
 * needs them.
 */

export const DEFAULT_RELEASES_URL = "https://github.com/elmir-mamedov/crescent/releases";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_FAILED_CHECK_MS = 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 5000;

/** An installed copy of KB25: the one-line installer's layout around this server. */
export interface Install {
  version: string;
  /** KB25_HOME, which holds node/, app/ and .env. */
  home: string;
  node: string;
  launcher: string;
  /** Where the update's installer output goes, for the page to point at. */
  logFile: string;
  /** The running server's pid, which updates and removal stop it by. */
  pidFile: string;
}

/**
 * The install this server runs from, or null when it runs from a checkout.
 * The installer lays out KB25_HOME/{node/, app/{server/, installer/, VERSION}}
 * (installer/common.mjs); a checkout running src/ through tsx has no
 * app/VERSION and no private Node, so it never offers to update itself.
 */
export function findInstall(
  serverDir: string,
  platform: NodeJS.Platform = process.platform
): Install | null {
  const app = path.resolve(serverDir, "..");
  const home = path.dirname(app);
  const node =
    platform === "win32" ? path.join(home, "node", "node.exe") : path.join(home, "node", "bin", "node");
  const launcher = path.join(app, "installer", "launcher.mjs");
  let version: string;
  try {
    version = fs.readFileSync(path.join(app, "VERSION"), "utf8").trim();
  } catch {
    return null;
  }
  if (!version || !fs.existsSync(node) || !fs.existsSync(launcher)) return null;
  return {
    version,
    home,
    node,
    launcher,
    logFile: path.join(home, "update.log"),
    pidFile: path.join(home, "server.pid"),
  };
}

/** Order two x.y.z versions numerically: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.trim().replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

export type UpdateState = "idle" | "updating" | "failed";

/** What GET /_update answers, and what the page's update card reads. */
export interface UpdateStatus {
  current: string;
  latest: string | null;
  available: boolean;
  notesUrl: string;
  state: UpdateState;
  logFile: string;
}

export type StartResult = { ok: true } | { ok: false; reason: string };

type Spawner = (
  command: string,
  args: string[],
  options: SpawnOptions
) => Pick<ChildProcess, "on" | "unref">;

export interface UpdaterOptions {
  install: Install;
  releasesUrl: string;
  platform?: NodeJS.Platform;
  fetch?: typeof fetch;
  now?: () => number;
  spawn?: Spawner;
}

export interface Updater {
  status(): Promise<UpdateStatus>;
  start(): Promise<StartResult>;
}

export function makeUpdater(options: UpdaterOptions): Updater {
  const { install, releasesUrl } = options;
  const platform = options.platform ?? process.platform;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const spawn: Spawner = options.spawn ?? ((command, args, opts) => nodeSpawn(command, args, opts));

  let latest: string | null = null;
  let nextCheckAt = 0;
  let checking: Promise<void> | null = null;
  let state: UpdateState = "idle";

  /** Refresh `latest`. A failed check keeps what was known and retries sooner. */
  async function check(): Promise<void> {
    try {
      const response = await fetchImpl(`${releasesUrl}/latest/download/VERSION`, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const text = response.ok ? (await response.text()).trim() : "";
      if (!/^\d+\.\d+\.\d+$/.test(text)) throw new Error(`no version in the release (${response.status})`);
      latest = text;
      nextCheckAt = now() + CHECK_EVERY_MS;
    } catch {
      nextCheckAt = now() + RETRY_FAILED_CHECK_MS;
    }
  }

  async function status(): Promise<UpdateStatus> {
    if (now() >= nextCheckAt) {
      checking ??= check().finally(() => {
        checking = null;
      });
      await checking;
    }
    return {
      current: install.version,
      latest,
      available: latest !== null && compareVersions(latest, install.version) > 0,
      notesUrl: latest ? `${releasesUrl}/tag/v${latest}` : `${releasesUrl}/latest`,
      state,
      logFile: install.logFile,
    };
  }

  async function start(): Promise<StartResult> {
    if (state === "updating") return { ok: false, reason: "An update is already running." };
    if (!(await status()).available) return { ok: false, reason: "Crescent is already up to date." };

    const [command, args] = updateCommand(platform, `${releasesUrl}/latest/download`, install);
    const log = fs.openSync(install.logFile, "w");
    let child: Pick<ChildProcess, "on" | "unref">;
    try {
      // Detached, so it outlives this server, which the installer stops before
      // swapping the app in and the launcher then starts again on the new one.
      child = spawn(command, args, {
        cwd: install.home,
        detached: true,
        stdio: ["ignore", log, log],
        windowsHide: true,
        // KB25_HOME pins the update to this install, wherever it was put.
        env: { ...process.env, KB25_UPDATE: "1", KB25_HOME: install.home },
      });
    } finally {
      fs.closeSync(log);
    }
    state = "updating";
    // Only heard while this server still runs, i.e. the installer quit before
    // it got as far as stopping the server: the update did not happen.
    child.on("exit", (code) => {
      state = code === 0 ? "idle" : "failed";
    });
    child.on("error", () => {
      state = "failed";
    });
    child.unref();
    return { ok: true };
  }

  return { status, start };
}

/**
 * The installer one-liner for this platform, run unattended. A successful run
 * starts the server itself (setup.mjs); a failed one may have stopped it first,
 * so the launcher then brings it back on whichever app is in place. Only on
 * failure: a second launch racing the first would start a second server. Exits
 * with the installer's code.
 */
export function updateCommand(
  platform: NodeJS.Platform,
  downloadUrl: string,
  install: Pick<Install, "node" | "launcher">
): [string, string[]] {
  if (platform === "win32") {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const script = [
      `try { irm ${quote(`${downloadUrl}/install.ps1`)} | iex; $code = $LASTEXITCODE } catch { $code = 1 }`,
      `if ($code) { & ${quote(install.node)} ${quote(install.launcher)} }`,
      "exit $code",
    ].join("\n");
    const powershell = path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    return [
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
    ];
  }
  return [
    "/bin/bash",
    [
      "-c",
      'set -o pipefail; curl -fsSL "$1" | bash; code=$?; [ $code -eq 0 ] || "$2" "$3"; exit $code',
      "kb25-update",
      `${downloadUrl}/install.sh`,
      install.node,
      install.launcher,
    ],
  ];
}
