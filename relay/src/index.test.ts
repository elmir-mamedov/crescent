import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import worker, { type Env } from "./index.ts";
import { MAX_BODY_BYTES } from "./report.ts";
import { body } from "./test-fixtures.ts";

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

const realFetch = globalThis.fetch;
let calls: Call[];
/** What the fake GitHub answers, in call order; the last one repeats. */
let answers: Response[];

beforeEach(() => {
  calls = [];
  answers = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const answer = answers.length > 1 ? answers.shift()! : answers[0];
    return answer?.clone() ?? new Response("{}", { status: 201 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function env(allowed = true): Env {
  return {
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO: "owner/feedback",
    PER_IP: { limit: async () => ({ success: allowed }) },
  };
}

function post(payload: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Request("https://relay.test/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers },
    body: text,
  });
}

async function send(request: Request, e = env()) {
  const response = await worker.fetch(request, e);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("only POST /reports is served", async () => {
  assert.equal((await send(new Request("https://relay.test/"))).status, 404);
  assert.equal((await send(new Request("https://relay.test/reports"))).status, 405);
});

test("a body that is too large or unsized is refused unread", async () => {
  assert.equal((await send(post(body(), { "content-length": String(MAX_BODY_BYTES + 1) }))).status, 413);
  const unsized = new Request("https://relay.test/reports", { method: "POST", body: "{}" });
  assert.equal((await send(unsized)).status, 411);
  assert.equal(calls.length, 0);
});

test("a sender over the rate limit is told to wait", async () => {
  const result = await send(post(body()), env(false));
  assert.equal(result.status, 429);
  assert.equal(calls.length, 0);
});

test("a malformed report is refused with the reason", async () => {
  assert.equal((await send(post("not json"))).status, 400);
  const result = await send(post(body({ kind: "rant" })));
  assert.equal(result.status, 400);
  assert.match(String(result.body.error), /bug, idea or question/);
  assert.equal(calls.length, 0);
});

test("a report commits its images, then opens a labelled issue that shows them", async () => {
  answers = [
    new Response("{}", { status: 201 }),
    new Response("{}", { status: 201 }),
    new Response(JSON.stringify({ number: 7 }), { status: 201 }),
  ];
  const payload = body({
    images: [
      { type: "image/png", data: "AAAA" },
      { type: "image/webp", data: "BBBB" },
    ],
  });
  const result = await send(post(payload));
  assert.deepEqual(result, { status: 201, body: { ok: true, issue: 7 } });

  const [first, second, issue] = calls;
  assert.equal(first.method, "PUT");
  assert.equal(first.url, `https://api.github.com/repos/owner/feedback/contents/reports/${payload.id}/1.png`);
  assert.equal(first.body.content, "AAAA");
  assert.equal(second.url, `https://api.github.com/repos/owner/feedback/contents/reports/${payload.id}/2.webp`);
  assert.equal(issue.method, "POST");
  assert.equal(issue.url, "https://api.github.com/repos/owner/feedback/issues");
  assert.deepEqual(issue.body.labels, ["bug"]);
  assert.equal(issue.body.title, "Search finds nothing");
  assert.match(
    String(issue.body.body),
    new RegExp(`!\\[Screenshot 2\\]\\(https://github\\.com/owner/feedback/blob/HEAD/reports/${payload.id}/2\\.webp\\?raw=true\\)`)
  );
});

test("an image already committed by an earlier try counts as done", async () => {
  answers = [new Response("{}", { status: 422 }), new Response(JSON.stringify({ number: 8 }), { status: 201 })];
  const result = await send(post(body()));
  assert.equal(result.status, 201);
  assert.equal(calls.length, 2);
});

test("a commit that loses a race is retried once", async () => {
  answers = [
    new Response("{}", { status: 409 }),
    new Response("{}", { status: 201 }),
    new Response(JSON.stringify({ number: 9 }), { status: 201 }),
  ];
  const result = await send(post(body()));
  assert.equal(result.status, 201);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["PUT", "PUT", "POST"]
  );
});

test("a GitHub failure is a 502, which the sender retries later", async (t) => {
  t.mock.method(console, "error", () => {});
  answers = [new Response("{}", { status: 201 }), new Response("Bad credentials", { status: 401 })];
  const result = await send(post(body()));
  assert.equal(result.status, 502);
  assert.match(String(result.body.error), /retried/);
});
