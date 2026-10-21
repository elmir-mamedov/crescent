import { test } from "node:test";
import assert from "node:assert/strict";
import { browserArgs, browserCandidates, findBrowser, windowPage, windowTracker } from "../installer/window.mjs";

const created = (targetId: string, type = "page") => ({
  method: "Target.targetCreated",
  params: { targetInfo: { targetId, type, url: "http://localhost:25250/" } },
});
const destroyed = (targetId: string) => ({ method: "Target.targetDestroyed", params: { targetId } });

test("the window counts as closed once its last page goes", () => {
  let closed = 0;
  const tracker = windowTracker(() => (closed += 1));
  tracker.handle(created("a"));
  tracker.handle(created("b"));
  tracker.handle(destroyed("a"));
  assert.equal(closed, 0);
  tracker.handle(destroyed("b"));
  assert.equal(closed, 1);
});

test("the browser's own extensions and workers are not windows", () => {
  let closed = 0;
  const tracker = windowTracker(() => (closed += 1));
  tracker.handle(created("ext", "background_page"));
  tracker.handle(created("sw", "service_worker"));
  tracker.handle(created("page"));
  assert.equal(tracker.count(), 1);
  // An extension stopping while the window is open closes nothing.
  tracker.handle(destroyed("ext"));
  assert.equal(closed, 0);
  tracker.handle(destroyed("page"));
  assert.equal(closed, 1);
  // Nor does one stopping as the browser shuts down afterwards.
  tracker.handle(destroyed("sw"));
  assert.equal(closed, 1);
});

test("a target that was never a window cannot close the last one", () => {
  let closed = 0;
  const tracker = windowTracker(() => (closed += 1));
  tracker.handle(destroyed("never-seen"));
  assert.equal(closed, 0);
});

test("macOS prefers Chrome, then Edge, in either Applications folder", () => {
  const candidates = browserCandidates("darwin", {}, "/Users/kb");
  assert.deepEqual(candidates.slice(0, 4), [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Users/kb/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Users/kb/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ]);
});

test("Windows prefers Edge, which every Windows has", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\kb\\AppData\\Local",
  };
  const candidates = browserCandidates("win32", env, "C:\\Users\\kb");
  assert.equal(candidates[0], "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
  assert.ok(candidates.includes("C:\\Users\\kb\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"));
});

test("findBrowser takes the first installed one, KB25_BROWSER first", () => {
  const installed = new Set([
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/opt/chromium",
  ]);
  const exists = (file: unknown) => installed.has(String(file));
  assert.equal(
    findBrowser({ platform: "darwin", env: {}, home: "/Users/kb", exists }),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  );
  assert.equal(
    findBrowser({ platform: "darwin", env: { KB25_BROWSER: "/opt/chromium" }, home: "/Users/kb", exists }),
    "/opt/chromium"
  );
  // A KB25_BROWSER that is not there falls back to the usual ones.
  assert.equal(
    findBrowser({ platform: "darwin", env: { KB25_BROWSER: "/missing" }, home: "/Users/kb", exists }),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  );
  assert.equal(findBrowser({ platform: "darwin", env: {}, home: "/Users/kb", exists: () => false }), null);
});

test("the window opens as an app on KB25's own profile", () => {
  assert.deepEqual(browserArgs("http://localhost:25250", "/kb25/window", ["--remote-debugging-pipe"]), [
    "--app=http://localhost:25250",
    "--user-data-dir=/kb25/window",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-pipe",
  ]);
});

test("a window opens on the page that marks it as KB25's window", () => {
  assert.equal(windowPage("http://localhost:25250"), "http://localhost:25250/#kb25-window");
  assert.equal(windowPage("http://localhost:4000/"), "http://localhost:4000/#kb25-window");
});
