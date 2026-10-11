import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { newReportId, parseReport, readReportBody, reportForm, type Report } from "@elmir-mamedov/feedback";
import { makeTempKb } from "./test-helpers.js";
import { checkoutVersion, makeFeedback, migrateOutbox, type FeedbackOptions } from "./feedback.js";

const RELAY = "https://relay.test";

/**
 * A fetch that answers with `answers` in turn (the last one repeats),
 * recording where each report went and the report itself.
 */
function fakeRelay(...answers: (Response | Error)[]) {
  const reports: Report[] = [];
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    const encoded = new Response(init?.body);
    const parsed = await readReportBody(await encoded.arrayBuffer(), encoded.headers.get("content-type")!);
    if (!parsed.ok) throw new Error(`the fake relay got a bad report: ${parsed.error}`);
    reports.push(parsed.report);
    const answer = answers.length > 1 ? answers.shift()! : answers[0];
    if (answer instanceof Error) throw answer;
    return answer.clone();
  }) as typeof fetch;
  return { impl, reports, urls };
}

const created = () => new Response(JSON.stringify({ ok: true, issue: 1 }), { status: 201 });

/** Feedback over a throwaway outbox and logs folder. */
async function setup(fetchImpl: typeof fetch, overrides: Partial<FeedbackOptions> = {}) {
  const tmp = await makeTempKb();
  const outboxDir = path.join(tmp.dir, "outbox");
  const options: FeedbackOptions = {
    relay: RELAY,
    outboxDir,
    version: "0.4.0",
    install: "installed",
    logFiles: [path.join(tmp.dir, "kb25.log")],
    fetch: fetchImpl,
    home: "/Users/someone",
    ...overrides,
  };
  const queued = async () => (await fs.readdir(outboxDir).catch(() => [] as string[])).sort();
  return { feedback: makeFeedback(options), options, dir: tmp.dir, outboxDir, queued, cleanup: tmp.cleanup };
}

/** What the dialog posts, valid or not: a report as multipart bytes, and its content type. */
async function dialogBody(overrides: Partial<Report> = {}): Promise<[Uint8Array, string]> {
  const report: Report = {
    id: newReportId(),
    kind: "bug",
    message: "Search finds nothing",
    images: [{ type: "image/png", data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
    version: "whatever the page said",
    facts: { Browser: "Mozilla/5.0", Page: "/engineering/deploy", OS: "what the page said" },
    ...overrides,
  };
  const encoded = new Response(reportForm(report));
  return [new Uint8Array(await encoded.arrayBuffer()), encoded.headers.get("content-type")!];
}

test("the dialog is told what the server adds, the log tail with the home folder hidden", async () => {
  const s = await setup(fakeRelay(created()).impl);
  try {
    let info = s.feedback.info();
    assert.equal(info.version, "0.4.0");
    assert.deepEqual(Object.keys(info.facts), ["Install", "OS", "Node"]);
    assert.equal(info.facts.Install, "installed");
    assert.equal(info.facts.Node, process.version);
    assert.equal(info.logs, null, "no log yet");
    assert.equal(info.queued, 0);
    await fs.writeFile(path.join(s.dir, "kb25.log"), "started from /Users/someone/KB25\n");
    info = s.feedback.info();
    assert.equal(info.logs, "== kb25.log ==\nstarted from ~/KB25");
  } finally {
    await s.cleanup();
  }
});

test("a report goes to KB25's path on the relay, with the server's own facts", async () => {
  const relay = fakeRelay(created());
  const s = await setup(relay.impl);
  try {
    assert.deepEqual(await s.feedback.submit(...(await dialogBody())), { status: "sent" });
    assert.deepEqual(relay.urls, [`${RELAY}/v1/kb25/reports`]);
    const [report] = relay.reports;
    assert.equal(report.version, "0.4.0");
    assert.equal(report.facts.OS, s.feedback.info().facts.OS);
    assert.equal(report.facts.Install, "installed");
    assert.equal(report.facts.Page, "/engineering/deploy", "what only the page knows stays");
    assert.equal(report.images.length, 1);
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("a body that isn't a report is refused, unsent and unqueued", async () => {
  const relay = fakeRelay(created());
  const s = await setup(relay.impl);
  try {
    const result = await s.feedback.submit(new TextEncoder().encode("{}"), "application/json");
    assert.deepEqual(result, { status: "refused", error: "The report is malformed." });
    const [empty, type] = await dialogBody({ message: "   " });
    assert.equal((await s.feedback.submit(empty, type)).status, "refused");
    assert.equal(relay.reports.length, 0);
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("a report the relay can't take waits in the outbox and goes on the next flush", async () => {
  const relay = fakeRelay(new TypeError("fetch failed"), created());
  const s = await setup(relay.impl);
  try {
    assert.deepEqual(await s.feedback.submit(...(await dialogBody())), { status: "queued" });
    assert.equal(s.feedback.info().queued, 1);
    assert.equal(await s.feedback.flush(), 1);
    assert.equal(relay.reports[1].id, relay.reports[0].id, "the same report, so the same image paths");
    assert.deepEqual(await s.queued(), []);
  } finally {
    await s.cleanup();
  }
});

test("reports KB25 0.3.0 queued in the old format are converted, keeping their order", async () => {
  const tmp = await makeTempKb();
  try {
    const dir = path.join(tmp.dir, "outbox");
    await fs.mkdir(dir);
    const old = {
      id: newReportId(),
      kind: "bug",
      message: "queued by 0.3.0",
      email: "someone@example.com",
      images: [{ type: "image/png", data: "iVBORw0KGgo=" }],
      diagnostics: {
        version: "0.3.0",
        install: "installed",
        os: "macOS (Darwin 25.6.0, arm64)",
        node: "v24.1.0",
        browser: "Mozilla/5.0",
        errors: ["TypeError: x is undefined"],
        logs: "== kb25.log ==\nready",
      },
    };
    const file = path.join(dir, `${old.id}.json`);
    await fs.writeFile(file, JSON.stringify(old));
    const when = new Date("2026-10-01T12:00:00Z");
    await fs.utimes(file, when, when);
    await fs.writeFile(path.join(dir, "broken.json"), "{not json");

    assert.equal(migrateOutbox(dir), 1);
    assert.equal((await fs.stat(file)).mtime.getTime(), when.getTime());
    const parsed = parseReport(JSON.parse(await fs.readFile(file, "utf8")));
    assert.equal(parsed.ok, false, "images are still base64 on disk, as the outbox keeps them");

    const relay = fakeRelay(created());
    const feedback = makeFeedback({
      relay: RELAY,
      outboxDir: dir,
      version: "0.4.0",
      install: "installed",
      logFiles: [],
      fetch: relay.impl,
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await feedback.flush(), 1);
    } finally {
      console.warn = warn;
    }
    const [sent] = relay.reports;
    assert.equal(sent.id, old.id);
    assert.equal(sent.version, "0.3.0", "the version it was written on");
    assert.deepEqual(sent.facts, {
      Install: "installed",
      OS: "macOS (Darwin 25.6.0, arm64)",
      Node: "v24.1.0",
      Browser: "Mozilla/5.0",
    });
    assert.deepEqual(sent.errors, ["TypeError: x is undefined"]);
    assert.equal(sent.logs, "== kb25.log ==\nready");
    assert.equal(migrateOutbox(path.join(tmp.dir, "missing")), 0);
  } finally {
    await tmp.cleanup();
  }
});

test("a checkout's version comes from its package.json", () => {
  assert.match(checkoutVersion(path.join(import.meta.dirname)), /^\d+\.\d+\.\d+$/);
  assert.equal(checkoutVersion("/nowhere/at/all"), "unknown");
});
