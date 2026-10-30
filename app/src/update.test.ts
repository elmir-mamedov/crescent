import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SpawnOptions } from "node:child_process";
import { makeTempKb } from "./test-helpers.js";
import { compareVersions, findInstall, makeUpdater, type Install } from "./update.js";

const RELEASES = "https://example.test/releases";
const HOUR = 60 * 60 * 1000;

/** A KB25_HOME laid out the way the installer leaves it. */
async function makeInstallDir(platform: NodeJS.Platform = "darwin", version = "0.2.0") {
  const tmp = await makeTempKb();
  const home = tmp.dir;
  await fs.mkdir(path.join(home, "app", "server"), { recursive: true });
  await fs.mkdir(path.join(home, "app", "installer"), { recursive: true });
  await fs.writeFile(path.join(home, "app", "installer", "launcher.mjs"), "");
  if (version) await fs.writeFile(path.join(home, "app", "VERSION"), `${version}\n`);
  const node = platform === "win32" ? path.join(home, "node", "node.exe") : path.join(home, "node", "bin", "node");
  await fs.mkdir(path.dirname(node), { recursive: true });
  await fs.writeFile(node, "");
  return { home, serverDir: path.join(home, "app", "server"), node, cleanup: tmp.cleanup };
}

/** A fetch that answers the release VERSION with `body`, counting calls. */
function fakeFetch(body: string | Error, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (body instanceof Error) throw body;
    return new Response(body, { status });
  }) as typeof fetch;
  return { impl, calls };
}

/** A spawn that records its call and hands back a child the test can end. */
function fakeSpawn() {
  const calls: { command: string; args: string[]; options: SpawnOptions }[] = [];
  const child = Object.assign(new EventEmitter(), { unref() {} });
  const impl = (command: string, args: string[], options: SpawnOptions) => {
    calls.push({ command, args, options });
    return child as never;
  };
  return { impl, calls, child };
}

test("versions compare numerically, not as text", () => {
  assert.ok(compareVersions("0.1.10", "0.1.9") > 0);
  assert.ok(compareVersions("0.2.0", "0.10.0") < 0);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.1", "0.1.0"), 0);
});

test("an installed layout is found, with the platform's Node", async () => {
  for (const platform of ["darwin", "win32"] as const) {
    const dir = await makeInstallDir(platform);
    try {
      const install = findInstall(dir.serverDir, platform);
      assert.deepEqual(install, {
        version: "0.2.0",
        home: dir.home,
        node: dir.node,
        launcher: path.join(dir.home, "app", "installer", "launcher.mjs"),
        logFile: path.join(dir.home, "update.log"),
        pidFile: path.join(dir.home, "server.pid"),
      });
    } finally {
      await dir.cleanup();
    }
  }
});

test("a checkout is not an install: no VERSION, or no private Node", async () => {
  const noVersion = await makeInstallDir("darwin", "");
  const noNode = await makeInstallDir("darwin");
  try {
    assert.equal(findInstall(noVersion.serverDir, "darwin"), null);
    await fs.rm(noNode.node);
    assert.equal(findInstall(noNode.serverDir, "darwin"), null);
  } finally {
    await noVersion.cleanup();
    await noNode.cleanup();
  }
});

function install(home: string, version = "0.2.0"): Install {
  return {
    version,
    home,
    node: "/kb25/node/bin/node",
    launcher: "/kb25/app/installer/launcher.mjs",
    logFile: path.join(home, "update.log"),
    pidFile: path.join(home, "server.pid"),
  };
}

test("a newer release is offered, with its release notes", async () => {
  const tmp = await makeTempKb();
  try {
    const { impl, calls } = fakeFetch("0.3.0\n");
    const status = await makeUpdater({ install: install(tmp.dir), releasesUrl: RELEASES, fetch: impl }).status();
    assert.deepEqual(calls, [`${RELEASES}/latest/download/VERSION`]);
    assert.equal(status.available, true);
    assert.equal(status.current, "0.2.0");
    assert.equal(status.latest, "0.3.0");
    assert.equal(status.notesUrl, `${RELEASES}/tag/v0.3.0`);
    assert.equal(status.state, "idle");
  } finally {
    await tmp.cleanup();
  }
});

test("the same or an older release is not offered", async () => {
  const tmp = await makeTempKb();
  try {
    for (const latest of ["0.2.0", "0.1.9"]) {
      const { impl } = fakeFetch(latest);
      const status = await makeUpdater({ install: install(tmp.dir), releasesUrl: RELEASES, fetch: impl }).status();
      assert.equal(status.available, false, latest);
    }
  } finally {
    await tmp.cleanup();
  }
});

test("the check runs at most every 6 hours", async () => {
  const tmp = await makeTempKb();
  try {
    let clock = 0;
    const { impl, calls } = fakeFetch("0.3.0");
    const updater = makeUpdater({ install: install(tmp.dir), releasesUrl: RELEASES, fetch: impl, now: () => clock });
    await Promise.all([updater.status(), updater.status()]);
    clock += 5 * HOUR;
    await updater.status();
    assert.equal(calls.length, 1);
    clock += 2 * HOUR;
    await updater.status();
    assert.equal(calls.length, 2);
  } finally {
    await tmp.cleanup();
  }
});

test("opening KB25 asks for a fresh check, unless one started within the last minute", async () => {
  const tmp = await makeTempKb();
  try {
    let clock = 0;
    let body = "0.2.0";
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(body);
    }) as typeof fetch;
    const updater = makeUpdater({ install: install(tmp.dir), releasesUrl: RELEASES, fetch: impl, now: () => clock });
    // The check the server starts with, then the window opening right after.
    await Promise.all([updater.status(), updater.status({ fresh: true })]);
    clock += 30 * 1000;
    await updater.status({ fresh: true });
    assert.equal(calls.length, 1);
    // Opened again an hour later, by when a release is out.
    body = "0.3.0";
    clock += HOUR;
    assert.equal((await updater.status()).available, false, "a page's own check still waits its 6 hours");
    assert.equal((await updater.status({ fresh: true })).available, true);
    assert.equal(calls.length, 2);
  } finally {
    await tmp.cleanup();
  }
});

test("each server answers with an id of its own, the same every time", async () => {
  const tmp = await makeTempKb();
  try {
    const options = { install: install(tmp.dir), releasesUrl: RELEASES, fetch: fakeFetch("0.3.0").impl };
    const first = makeUpdater(options);
    const { instance } = await first.status();
    assert.match(instance, /^[0-9a-f-]{36}$/);
    assert.equal((await first.status()).instance, instance);
    assert.notEqual((await makeUpdater(options).status()).instance, instance);
  } finally {
    await tmp.cleanup();
  }
});

test("a failed check offers nothing and retries after an hour", async () => {
  const tmp = await makeTempKb();
  try {
    for (const { body, status: code } of [
      { body: new Error("offline"), status: 200 },
      { body: "Not Found", status: 404 },
      { body: "<html>sign in</html>", status: 200 },
    ]) {
      let clock = 0;
      const { impl, calls } = fakeFetch(body, code);
      const updater = makeUpdater({ install: install(tmp.dir), releasesUrl: RELEASES, fetch: impl, now: () => clock });
      assert.equal((await updater.status()).available, false);
      clock += 30 * 60 * 1000;
      await updater.status();
      assert.equal(calls.length, 1);
      clock += HOUR;
      await updater.status();
      assert.equal(calls.length, 2);
    }
  } finally {
    await tmp.cleanup();
  }
});

test("start refuses when there is nothing to update to", async () => {
  const tmp = await makeTempKb();
  try {
    const spawn = fakeSpawn();
    const updater = makeUpdater({
      install: install(tmp.dir),
      releasesUrl: RELEASES,
      fetch: fakeFetch("0.2.0").impl,
      spawn: spawn.impl,
    });
    assert.deepEqual(await updater.start(), { ok: false, reason: "Crescent is already up to date." });
    assert.equal(spawn.calls.length, 0);
  } finally {
    await tmp.cleanup();
  }
});

test("start runs the release's installer unattended and detached, the launcher only if it fails", async () => {
  const tmp = await makeTempKb();
  try {
    const spawn = fakeSpawn();
    const updater = makeUpdater({
      install: install(tmp.dir),
      releasesUrl: RELEASES,
      platform: "darwin",
      fetch: fakeFetch("0.3.0").impl,
      spawn: spawn.impl,
    });
    assert.deepEqual(await updater.start(), { ok: true });
    const [{ command, args, options }] = spawn.calls;
    assert.equal(command, "/bin/bash");
    assert.deepEqual(args.slice(2), [
      "kb25-update",
      `${RELEASES}/latest/download/install.sh`,
      "/kb25/node/bin/node",
      "/kb25/app/installer/launcher.mjs",
    ]);
    assert.match(args[1], /curl -fsSL "\$1" \| bash; code=\$\?; \[ \$code -eq 0 \] \|\| "\$2" "\$3"; exit \$code/);
    assert.equal(options.detached, true);
    assert.equal(options.cwd, tmp.dir);
    assert.equal(options.env?.KB25_UPDATE, "1");
    assert.equal(options.env?.KB25_HOME, tmp.dir);
    assert.equal((await updater.status()).state, "updating");
    assert.deepEqual(await updater.start(), { ok: false, reason: "An update is already running." });
    assert.equal(spawn.calls.length, 1);
  } finally {
    await tmp.cleanup();
  }
});

test("an installer that quits while this server still runs marks the update failed", async () => {
  const tmp = await makeTempKb();
  try {
    const spawn = fakeSpawn();
    const updater = makeUpdater({
      install: install(tmp.dir),
      releasesUrl: RELEASES,
      fetch: fakeFetch("0.3.0").impl,
      spawn: spawn.impl,
    });
    await updater.start();
    spawn.child.emit("exit", 1);
    assert.equal((await updater.status()).state, "failed");
    assert.deepEqual(await updater.start(), { ok: true }, "a failed update can be tried again");
  } finally {
    await tmp.cleanup();
  }
});

test("on Windows the update runs install.ps1 in a hidden PowerShell", async () => {
  const tmp = await makeTempKb();
  try {
    const spawn = fakeSpawn();
    const updater = makeUpdater({
      install: { ...install(tmp.dir), node: "C:\\KB25\\node\\node.exe", launcher: "C:\\KB25\\app\\installer\\launcher.mjs" },
      releasesUrl: RELEASES,
      platform: "win32",
      fetch: fakeFetch("0.3.0").impl,
      spawn: spawn.impl,
    });
    await updater.start();
    const [{ command, args, options }] = spawn.calls;
    assert.match(command, /powershell\.exe$/);
    assert.ok(args.includes("-NonInteractive") && args.includes("Hidden"));
    const script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");
    assert.match(script, /irm 'https:\/\/example\.test\/releases\/latest\/download\/install\.ps1' \| iex/);
    assert.match(script, /if \(\$code\) \{ & 'C:\\KB25\\node\\node\.exe' 'C:\\KB25\\app\\installer\\launcher\.mjs' \}/);
    assert.match(script, /exit \$code$/);
    assert.equal(options.windowsHide, true);
  } finally {
    await tmp.cleanup();
  }
});
