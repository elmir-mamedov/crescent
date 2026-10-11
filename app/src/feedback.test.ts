import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { makeTempKb } from "./test-helpers.js";
import { checkoutVersion, describeOs, logTail, makeFeedback, type FeedbackOptions } from "./feedback.js";

const ENDPOINT = "https://relay.test/reports";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fetch that answers with `answers` in turn (the last one repeats), recording each report. */
function fakeRelay(...answers: (Response | Error)[]) {
  const reports: Record<string, any>[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    reports.push(JSON.parse(String(init?.body)));
    const answer = answers.length > 1 ? answers.shift()! : answers[0];
    if (answer instanceof Error) throw answer;
    return answer.clone();
  }) as typeof fetch;
  return { impl, reports };
}

const created = () => new Response(JSON.stringify({ ok: true, issue: 1 }), { status: 201 });
const refused = (error: string) => new Response(JSON.stringify({ error }), { status: 400 });

/** A feedback sender over a throwaway outbox and logs folder. */
async function setup(fetchImpl: typeof fetch, overrides: Partial<FeedbackOptions> = {}) {
  const tmp = await makeTempKb();
  const outboxDir = path.join(tmp.dir, "outbox");
  const feedback = makeFeedback({
    endpoint: ENDPOINT,
    outboxDir,
    version: "0.2.0",
    install: "installed",
    logFiles: [path.join(tmp.dir, "kb25.log"), path.join(tmp.dir, "update.log")],
    fetch: fetchImpl,
    home: "/Users/someone",
    ...overrides,
  });
  const queued = async () => (await fs.readdir(outboxDir).catch(() => [] as string[])).sort();
  return { feedback, dir: tmp.dir, outboxDir, queued, cleanup: tmp.cleanup };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  kind: "bug",
  message: "Search finds nothing",
  email: "someone@example.com",
  images: [{ type: "image/png", data: "iVBORw0KGgo=" }],
  browser: "Mozilla/5.0",
  page: "/engineering/deploy",
  errors: ["TypeError: x is undefined"],
  includeLogs: false,
  ...overrides,
});

test("a report goes to the relay with what the server knows added", async () => {
  const relay = fakeRelay(created());
  const s = await setup(relay.impl);
  try {
    assert.deepEqual(await s.feedback.submit(input()), { status: "sent" });
    const [report] = relay.reports;
    assert.match(report.id, UUID);
    assert.equal(report.kind, "bug");
    assert.deepEqual(report.images, [{ type: "image/png", data: "iVBORw0KGgo=" }]);
    assert.equal(report.diagnostics.version, "0.2.0");
    assert.equal(report.diagnostics.install, "installed");
    assert.equal(report.diagnostics.node, process.version);
    assert.equal(report.diagnostics.page, "/engineering/deploy");
    assert.equal(report.diagnostics.logs, undefined, "logs only when asked");
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("the log tail goes only when asked, with the home folder hidden", async () => {
  const relay = fakeRelay(created());
  const s = await setup(relay.impl);
  try {
    await fs.writeFile(path.join(s.dir, "kb25.log"), "started from /Users/someone/KB25\n");
    await s.feedback.submit(input({ includeLogs: true }));
    assert.equal(relay.reports[0].diagnostics.logs, "== kb25.log ==\nstarted from ~/KB25");
  } finally {
    await s.cleanup();
  }
});

test("a report the relay would refuse is refused here, unsent and unqueued", async () => {
  const relay = fakeRelay(created());
  const s = await setup(relay.impl);
  try {
    const result = await s.feedback.submit(input({ message: "   " }));
    assert.deepEqual(result, { status: "refused", error: "The message is empty." });
    assert.equal((await s.feedback.submit("nonsense")).status, "refused");
    assert.equal(relay.reports.length, 0);
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("the relay's own refusal reaches the person, and nothing is queued", async () => {
  const s = await setup(fakeRelay(refused("The images add up to more than 6 MB.")).impl);
  try {
    assert.deepEqual(await s.feedback.submit(input()), {
      status: "refused",
      error: "The images add up to more than 6 MB.",
    });
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("offline, rate-limited or a relay failure: the report waits in the outbox", async () => {
  const relay = fakeRelay(
    new TypeError("fetch failed"),
    new Response("{}", { status: 429 }),
    new Response("{}", { status: 502 })
  );
  const s = await setup(relay.impl);
  try {
    for (let i = 0; i < 3; i++) assert.deepEqual(await s.feedback.submit(input()), { status: "queued" });
    const files = await s.queued();
    assert.equal(files.length, 3);
    assert.ok(files.every((name) => UUID.test(name.replace(/\.json$/, ""))));
    assert.equal((await s.feedback.preview()).queued, 3);
  } finally {
    await s.cleanup();
  }
});

test("a flush sends the outbox oldest first, keeping the same report ids", async () => {
  const relay = fakeRelay(new TypeError("fetch failed"), new TypeError("fetch failed"), created());
  const s = await setup(relay.impl);
  try {
    await s.feedback.submit(input({ message: "first" }));
    await new Promise((resolve) => setTimeout(resolve, 15)); // distinct mtimes
    await s.feedback.submit(input({ message: "second" }));
    const firstTry = relay.reports.map((r) => r.id);

    assert.equal(await s.feedback.flush(), 2);
    const retried = relay.reports.slice(2);
    assert.deepEqual(
      retried.map((r) => r.message),
      ["first", "second"]
    );
    assert.deepEqual(
      retried.map((r) => r.id),
      firstTry
    );
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("a flush stops at the first report that still can't go, and drops refused ones", async () => {
  const relay = fakeRelay(
    new TypeError("fetch failed"),
    new TypeError("fetch failed"),
    refused("The report id is malformed."),
    new TypeError("fetch failed")
  );
  const s = await setup(relay.impl);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await s.feedback.submit(input({ message: "first" }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    await s.feedback.submit(input({ message: "second" }));
    assert.equal(await s.feedback.flush(), 0);
    // The first was refused and dropped; the second is still unreachable and kept.
    const [left] = await s.queued();
    const kept = JSON.parse(await fs.readFile(path.join(s.outboxDir, left), "utf8"));
    assert.equal(kept.message, "second");
  } finally {
    console.warn = warn;
    await s.cleanup();
  }
});

test("a successful send also flushes what was waiting", async () => {
  const relay = fakeRelay(new TypeError("fetch failed"), created());
  const s = await setup(relay.impl);
  try {
    await s.feedback.submit(input({ message: "queued" }));
    await s.feedback.submit(input({ message: "fresh" }));
    await s.feedback.flush(); // joins the flush the send started
    assert.deepEqual(
      relay.reports.map((r) => r.message),
      ["queued", "fresh", "queued"]
    );
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("the preview shows what the server adds, and the relay's limits", async () => {
  const s = await setup(fakeRelay(created()).impl);
  try {
    let preview = await s.feedback.preview();
    assert.equal(preview.version, "0.2.0");
    assert.equal(preview.logs, null, "no log yet");
    assert.equal(preview.queued, 0);
    assert.equal(preview.limits.images, 5);
    await fs.writeFile(path.join(s.dir, "update.log"), "updated\n");
    preview = await s.feedback.preview();
    assert.equal(preview.logs, "== update.log ==\nupdated");
  } finally {
    await s.cleanup();
  }
});

test("the log tail keeps the last whole lines, each cut to length", async () => {
  const tmp = await makeTempKb();
  try {
    const file = path.join(tmp.dir, "kb25.log");
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    lines.push("x".repeat(400));
    await fs.writeFile(file, lines.join("\r\n") + "\n");
    const tail = logTail([file, path.join(tmp.dir, "missing.log")], "")!.split("\n");
    assert.equal(tail[0], "== kb25.log ==");
    assert.equal(tail.length, 41);
    assert.equal(tail[1], "line 61");
    assert.equal(tail[40], `${"x".repeat(300)}…`);
    assert.equal(logTail([path.join(tmp.dir, "missing.log")]), null);
  } finally {
    await tmp.cleanup();
  }
});

test("the OS reads as a person knows it", () => {
  assert.equal(describeOs("darwin", "25.6.0", "arm64"), "macOS (Darwin 25.6.0, arm64)");
  assert.equal(describeOs("win32", "10.0.26100", "x64"), "Windows (10.0.26100, x64)");
  assert.equal(describeOs("freebsd", "14.1", "x64"), "freebsd (14.1, x64)");
});

test("a checkout's version comes from its package.json", async () => {
  assert.match(checkoutVersion(path.join(import.meta.dirname)), /^\d+\.\d+\.\d+$/);
  assert.equal(checkoutVersion("/nowhere/at/all"), "unknown");
});
