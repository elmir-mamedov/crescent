import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  MAX_BODY_BYTES,
  base64Bytes,
  defuseMentions,
  fenced,
  imagePath,
  issueBody,
  issueTitle,
  parseReport,
  type Report,
} from "./report.ts";
import { ID, body } from "./test-fixtures.ts";

function parsed(overrides: Record<string, unknown> = {}): Report {
  const result = parseReport(body(overrides));
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.report;
}

function refusal(overrides: Record<string, unknown>): string {
  const result = parseReport(body(overrides));
  assert.equal(result.ok, false);
  return result.ok ? "" : result.error;
}

test("a well-formed report parses, blanks dropped", () => {
  const report = parsed({ email: "  ", diagnostics: { ...(body().diagnostics as object), page: "", errors: [] } });
  assert.equal(report.kind, "bug");
  assert.equal(report.email, undefined);
  assert.equal(report.diagnostics.page, undefined);
  assert.equal(report.diagnostics.errors, undefined);
  assert.equal(report.images.length, 1);
});

test("images are optional", () => {
  assert.deepEqual(parsed({ images: undefined }).images, []);
});

test("refusals say what is wrong", () => {
  assert.match(refusal({ id: "../../etc" }), /id/);
  assert.match(refusal({ kind: "rant" }), /bug, idea or question/);
  assert.match(refusal({ message: "  \n " }), /empty/);
  assert.match(refusal({ message: "x".repeat(LIMITS.message + 1) }), /longer than/);
  assert.match(refusal({ email: "not an address" }), /email/);
  assert.match(refusal({ images: [{ type: "image/svg+xml", data: "AAAA" }] }), /PNG, JPEG, WebP or GIF/);
  assert.match(refusal({ images: [{ type: "image/png", data: "not base64!" }] }), /base64/);
  assert.match(refusal({ images: Array(LIMITS.images + 1).fill({ type: "image/png", data: "AAAA" }) }), /at most/);
  assert.match(refusal({ diagnostics: { install: "somewhere" } }), /Diagnostics/);
  assert.match(refusal({ diagnostics: undefined }), /Diagnostics/);
  assert.equal(parseReport("a string").ok, false);
  assert.equal(parseReport(null).ok, false);
});

test("image size is measured decoded, per image and in total", () => {
  assert.equal(base64Bytes("AAAA"), 3);
  assert.equal(base64Bytes("AAA="), 2);
  assert.equal(base64Bytes("AA=="), 1);
  const justOver = "A".repeat(Math.ceil(((LIMITS.imageBytes + 3) * 4) / 3 / 4) * 4);
  assert.match(refusal({ images: [{ type: "image/png", data: justOver }] }), /larger than 2 MB/);
  const big = "A".repeat(Math.floor((LIMITS.imageBytes * 4) / 3 / 4) * 4);
  assert.match(refusal({ images: Array(4).fill({ type: "image/png", data: big }) }), /more than 6 MB/);
  assert.ok(MAX_BODY_BYTES > (LIMITS.totalImageBytes * 4) / 3);
});

test("image paths are keyed by the report id, so a retry lands on the same paths", () => {
  const report = parsed({
    images: [
      { type: "image/webp", data: "AAAA" },
      { type: "image/jpeg", data: "AAAA" },
    ],
  });
  assert.equal(imagePath(report, 0), `reports/${ID}/1.webp`);
  assert.equal(imagePath(report, 1), `reports/${ID}/2.jpg`);
});

test("mentions are defused, emails and plain @ left readable", () => {
  assert.equal(defuseMentions("cc @octocat"), "cc @​octocat");
  assert.equal(defuseMentions("@org/team"), "@​org/team");
  assert.equal(defuseMentions("a @ b"), "a @ b");
});

test("a fence outlasts any backtick run inside it", () => {
  assert.equal(fenced("plain"), "```text\nplain\n```");
  assert.equal(fenced("has ``` inside"), "````text\nhas ``` inside\n````");
});

test("the title is the first non-blank line, cut to fit", () => {
  assert.equal(issueTitle(parsed({ message: "\n  Search finds nothing  \nmore" })), "Search finds nothing");
  const long = issueTitle(parsed({ message: "word ".repeat(40) }));
  assert.ok(long.length <= 80 && long.endsWith("…"));
  assert.equal(issueTitle(parsed({ message: "@octocat look" })), "@​octocat look");
});

test("the body carries the message, screenshots and diagnostics", () => {
  const report = parsed({
    message: "It broke, cc @octocat",
    diagnostics: {
      ...(body().diagnostics as object),
      errors: ["TypeError: x is undefined"],
      logs: "listening on 4000",
    },
  });
  const md = issueBody(report, ["https://github.com/o/r/blob/HEAD/reports/x/1.png?raw=true"]);
  assert.match(md, /^It broke, cc @​octocat/);
  assert.match(md, /\*\*Bug\*\* · KB25 0\.2\.0 · reply to someone@​example\.com/);
  assert.match(md, /!\[Screenshot 1\]\(https:\/\/github\.com\/o\/r\/blob\/HEAD\/reports\/x\/1\.png\?raw=true\)/);
  assert.match(md, /KB25 {5}0\.2\.0 \(installed\)/);
  assert.match(md, /Page {5}\/engineering\/runbooks\/deploy/);
  assert.match(md, /Errors in the browser \(1\)[\s\S]*TypeError: x is undefined/);
  assert.match(md, /Log tail[\s\S]*listening on 4000/);
  assert.match(md, new RegExp(`Report ${ID}`));
});

test("a report without extras says so and skips their sections", () => {
  const report = parsed({ email: undefined, images: [], diagnostics: { ...(body().diagnostics as object), page: undefined } });
  const md = issueBody(report, []);
  assert.match(md, /no reply address/);
  assert.doesNotMatch(md, /Screenshots|Errors in the browser|Log tail|Page /);
});
