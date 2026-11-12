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
        updatedFile: path.join(dir.home, "updated.json"),
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
    updatedFile: path.join(home, "updated.json"),
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

/** installer/common.mjs, plain JS outside tsc's reach, loaded by URL. */
async function installerCommon() {
  const url = new URL("../installer/common.mjs", import.meta.url).href;
  return (await import(url)) as {
    recordUpdate(file: string, from: string, to: string): void;
    copySkill(source: string, dir: string): void;
    isOurSkill(dir: string): boolean;
  };
}

const MESSAGES = {
  "0.1.0": "before the update",
  "0.1.5": "Restart Claude.",
  "0.2.0": "Your pages moved.",
  "0.3.0": "not out yet",
  "next": "not a version",
};

test("after an update, the status says from what, with the release notes and each message since", async () => {
  const tmp = await makeTempKb();
  try {
    const target = install(tmp.dir);
    await fs.writeFile(target.updatedFile, `${JSON.stringify({ from: "0.1.0", to: "0.2.0" })}\n`);
    const { impl } = fakeFetch("0.2.0\n");
    const status = await makeUpdater({ install: target, releasesUrl: RELEASES, fetch: impl, messages: MESSAGES }).status();
    assert.deepEqual(status.updated, {
      from: "0.1.0",
      to: "0.2.0",
      notesUrl: `${RELEASES}/tag/v0.2.0`,
      messages: [
        { version: "0.1.5", text: "Restart Claude." },
        { version: "0.2.0", text: "Your pages moved." },
      ],
    });
    assert.equal(status.available, false);
  } finally {
    await tmp.cleanup();
  }
});

test("an update with no message for its versions still says it happened", async () => {
  const tmp = await makeTempKb();
  try {
    const target = install(tmp.dir);
    await fs.writeFile(target.updatedFile, JSON.stringify({ from: "0.1.9", to: "0.2.0" }));
    const { impl } = fakeFetch("0.2.0\n");
    const status = await makeUpdater({ install: target, releasesUrl: RELEASES, fetch: impl, messages: {} }).status();
    assert.deepEqual(status.updated?.messages, []);
    assert.equal(status.updated?.to, "0.2.0");
  } finally {
    await tmp.cleanup();
  }
});

test("no record, a broken one, or one of an update to another version is no update", async () => {
  const tmp = await makeTempKb();
  try {
    const target = install(tmp.dir);
    const { impl } = fakeFetch("0.2.0\n");
    const updater = makeUpdater({ install: target, releasesUrl: RELEASES, fetch: impl, messages: MESSAGES });
    assert.equal((await updater.status()).updated, null);
    for (const record of [
      "{not json",
      "null",
      JSON.stringify({ from: "0.1.0", to: "0.1.9" }),
      JSON.stringify({ from: "0.2.0", to: "0.2.0" }),
      JSON.stringify({ from: "0.3.0", to: "0.2.0" }),
      JSON.stringify({ from: "old", to: "0.2.0" }),
    ]) {
      await fs.writeFile(target.updatedFile, record);
      assert.equal((await updater.status()).updated, null, record);
    }
  } finally {
    await tmp.cleanup();
  }
});

test("seen forgets the update, and is harmless with none to forget", async () => {
  const tmp = await makeTempKb();
  try {
    const target = install(tmp.dir);
    await fs.writeFile(target.updatedFile, JSON.stringify({ from: "0.1.0", to: "0.2.0" }));
    const { impl } = fakeFetch("0.2.0\n");
    const updater = makeUpdater({ install: target, releasesUrl: RELEASES, fetch: impl, messages: MESSAGES });
    assert.ok((await updater.status()).updated);
    await updater.seen();
    assert.equal((await updater.status()).updated, null);
    await assert.rejects(fs.stat(target.updatedFile));
    await updater.seen();
  } finally {
    await tmp.cleanup();
  }
});

test("the installer records an update, keeping where an unseen one started", async () => {
  const tmp = await makeTempKb();
  try {
    const { recordUpdate } = await installerCommon();
    const file = path.join(tmp.dir, "updated.json");
    const read = async () => JSON.parse(await fs.readFile(file, "utf8"));
    recordUpdate(file, "0.20.0", "0.21.0");
    assert.deepEqual(await read(), { from: "0.20.0", to: "0.21.0" });
    // Updated again before that card was closed: the next page names both releases.
    recordUpdate(file, "0.21.0", "0.21.1");
    assert.deepEqual(await read(), { from: "0.20.0", to: "0.21.1" });
    // A record that doesn't lead to this update is someone else's.
    recordUpdate(file, "0.22.0", "0.23.0");
    assert.deepEqual(await read(), { from: "0.22.0", to: "0.23.0" });
    await fs.writeFile(file, "{broken");
    recordUpdate(file, "0.23.0", "0.24.0");
    assert.deepEqual(await read(), { from: "0.23.0", to: "0.24.0" });
    // Nowhere to write: the update goes on without its card.
    assert.doesNotThrow(() => recordUpdate(path.join(tmp.dir, "missing", "updated.json"), "0.1.0", "0.2.0"));
  } finally {
    await tmp.cleanup();
  }
});

test("the installer copies its skill in, refreshes its own copy, and leaves a person's own alone", async () => {
  const tmp = await makeTempKb();
  try {
    const { copySkill, isOurSkill } = await installerCommon();
    const source = path.join(tmp.dir, "release", "kb-page-authoring");
    const dir = path.join(tmp.dir, "skills", "kb-page-authoring");
    const read = () => fs.readFile(path.join(dir, "SKILL.md"), "utf8");
    await fs.mkdir(source, { recursive: true });

    await fs.writeFile(path.join(source, "SKILL.md"), "0.22.0");
    copySkill(source, dir);
    assert.equal(await read(), "0.22.0");
    assert.equal(isOurSkill(dir), true);

    // An update brings a newer skill, and a file the old one had goes with it.
    await fs.writeFile(path.join(dir, "old.md"), "dropped");
    await fs.writeFile(path.join(source, "SKILL.md"), "0.23.0");
    copySkill(source, dir);
    assert.equal(await read(), "0.23.0");
    await assert.rejects(fs.stat(path.join(dir, "old.md")));

    // A release without the skill changes nothing.
    copySkill(path.join(tmp.dir, "release", "missing"), dir);
    assert.equal(await read(), "0.23.0");

    // A skill the person wrote under the same name isn't ours to replace.
    const own = path.join(tmp.dir, "own", "kb-page-authoring");
    await fs.mkdir(own, { recursive: true });
    await fs.writeFile(path.join(own, "SKILL.md"), "mine");
    assert.equal(isOurSkill(own), false);
    copySkill(source, own);
    assert.equal(await fs.readFile(path.join(own, "SKILL.md"), "utf8"), "mine");
    assert.equal(isOurSkill(path.join(tmp.dir, "nowhere")), false);
  } finally {
    await tmp.cleanup();
  }
});
