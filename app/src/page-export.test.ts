import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadFilename, downloadMarkdown } from "./page-export.js";

test("issue #3: downloadFilename uses the slug leaf plus .md", () => {
  assert.equal(downloadFilename("kb25/backlog/issues"), "issues.md");
  assert.equal(downloadFilename("kb25"), "kb25.md");
  assert.equal(downloadFilename("/kb25/notes/"), "notes.md");
  assert.equal(downloadFilename(""), "page.md");
});

test("feedback #59: a downloaded page leaves its metadata behind and keeps its title", () => {
  const raw = [
    "---",
    "title: Entanglement",
    "id: 1oye7a74fnmnb",
    "order: 3",
    "tags:",
    "  - epr",
    "labels:",
    "  - Draft",
    "summary: Two particles, one state.",
    "---",
    "",
    "Two particles can share one state.",
    "",
    "## A Bell state",
    "",
  ].join("\n");
  assert.equal(
    downloadMarkdown(raw),
    "# Entanglement\n\nTwo particles can share one state.\n\n## A Bell state\n"
  );
});

test("feedback #59: a downloaded page's title is one line, and a page without one is its body", () => {
  assert.equal(downloadMarkdown('---\ntitle: "Two\\n  lines"\n---\nBody'), "# Two lines\n\nBody\n");
  assert.equal(downloadMarkdown("---\ntags: [a]\n---\nBody\n"), "Body\n");
  assert.equal(downloadMarkdown("No header here.\n"), "No header here.\n");
});

test("feedback #59: a header that cannot be read is downloaded as it is", () => {
  const raw = "---\ntitle: Open\nBody with no closing line\n";
  assert.equal(downloadMarkdown(raw), raw);
});
