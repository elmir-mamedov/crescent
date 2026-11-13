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

test("feedback #60: a downloaded page leaves its inline notes behind", () => {
  const raw = [
    "---",
    "title: The wavefunction",
    "---",
    "<!-- kb25:note id=aaaaaaaa kind=remark at=2026-11-08T10:15:00Z by=admin",
    "> A state",
    "",
    "Sits above the first block.",
    "-->",
    "A state is a list of amplitudes.",
    "",
    "<!-- kb25:note id=bbbbbbbb kind=task at=2026-11-08T10:15:00Z by=admin",
    "> two distinct outcomes",
    "",
    "Add a worked example.",
    "-->",
    "",
    "Two distinct outcomes.",
    "",
    "<!-- kb25:note id=cccccccc kind=highlight at=2026-11-09T08:00:00Z by=admin -->",
    "",
    "<!-- flux:note id=dddddddd kind=agent at=2026-11-09T08:00:00Z",
    "Written before the rename.",
    "-->",
    "",
    "A last paragraph.",
    "",
    "<!-- kb25:note id=eeeeeeee kind=agent at=2026-11-09T08:00:00Z",
    "Trails the page.",
    "-->",
    "",
  ].join("\n");
  assert.equal(
    downloadMarkdown(raw),
    "# The wavefunction\n\nA state is a list of amplitudes.\n\nTwo distinct outcomes.\n\nA last paragraph.\n"
  );
});

test("feedback #60: a note written out as an example in code is part of the page", () => {
  const raw = "---\ntitle: Notes\n---\n```markdown\n<!-- kb25:note id=demo kind=task\nAn example.\n-->\n```\n";
  assert.equal(
    downloadMarkdown(raw),
    "# Notes\n\n```markdown\n<!-- kb25:note id=demo kind=task\nAn example.\n-->\n```\n"
  );
});

test("a downloaded page with a title and nothing else is its heading", () => {
  assert.equal(downloadMarkdown("---\ntitle: Empty\n---\n\n"), "# Empty\n");
});

test("feedback #59: a header that cannot be read is downloaded as it is", () => {
  const raw = "---\ntitle: Open\nBody with no closing line\n";
  assert.equal(downloadMarkdown(raw), raw);
});
