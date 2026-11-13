import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadFilename, downloadMarkdown as exportPage, type ExportContext } from "./page-export.js";

/** Two spaces' worth of pages, as the title and id indexes give them. */
const TITLES = new Map([
  ["physics", "Physics"],
  ["physics/entanglement", "Entanglement"],
  ["physics/measurement", "Measurement"],
  ["physics/measurement/uncertainty", "The *uncertainty* principle"],
  ["physics/bell-tests", "Bell tests"],
  ["notes/c-sharp", "C# | F# & <others>"],
]);
const IDS = new Map([
  ["ent00000000000", "physics/entanglement"],
  ["unc00000000000", "physics/measurement/uncertainty"],
  ["bel00000000000", "physics/bell-tests"],
]);

function context(slug = "physics/entanglement"): ExportContext {
  return { slug, resolveTitle: (s) => TITLES.get(s), resolveIdSlug: (id) => IDS.get(id) };
}

/** The page as Download writes it, from the page at `slug`. */
function downloadMarkdown(raw: string, slug?: string): string {
  return exportPage(raw, context(slug));
}

/** The body of a titled page at `slug`, as Download writes it, without the heading. */
function exportBody(body: string, slug?: string): string {
  return downloadMarkdown(`---\ntitle: T\n---\n${body}\n`, slug).replace(/^# T\n\n/, "").replace(/\n$/, "");
}

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

test("feedback #60: a wiki-link in a downloaded page is the text the page shows for it", () => {
  assert.equal(exportBody("See [[id:bel00000000000]]."), "See Bell tests.");
  assert.equal(exportBody("See [[id:unc00000000000|the uncertainty principle]]."), "See the uncertainty principle.");
  assert.equal(exportBody("See [[physics/bell-tests]] and [[measurement]]."), "See Bell tests and Measurement.");
  // A section of another page is still a page that is not in the file.
  assert.equal(exportBody("[[id:bel00000000000#loopholes|Loopholes]] closed."), "Loopholes closed.");
  // A link nothing answers shows what the page shows: its label, or its id.
  assert.equal(exportBody("[[id:gone000000000]] and [[id:gone000000000|a lost page]]"), "gone000000000 and a lost page");
  assert.equal(exportBody("[[no-such-page]]"), "no-such-page");
});

test("feedback #60: a downloaded wiki-link's text cannot turn into Markdown of its own", () => {
  assert.equal(exportBody("[[id:unc00000000000]]"), "The \\*uncertainty\\* principle");
  assert.equal(exportBody("[[notes/c-sharp]]"), "C# \\| F# \\& \\<others\\>");
  assert.equal(exportBody("[[id:bel00000000000|snake_case _and_ more]]"), "snake_case \\_and\\_ more");
  // In a table the pipe was escaped to keep the cell, and the text keeps it.
  assert.equal(
    exportBody("| Page |\n| --- |\n| [[id:bel00000000000\\|the tests]] |"),
    "| Page |\n| --- |\n| the tests |"
  );
});

test("feedback #60: a downloaded link to a section of the page itself still leads there", () => {
  assert.equal(exportBody("[[id:ent00000000000#a-bell-state|Below]]"), "[Below](#a-bell-state)");
  assert.equal(exportBody("[[physics/entanglement#a-bell-state]]"), "[Entanglement](#a-bell-state)");
  assert.equal(exportBody("[[id:ent00000000000]] itself"), "Entanglement itself");
  assert.equal(exportBody("[below](#a-bell-state) and [here](/physics/entanglement#a-bell-state)"), "[below](#a-bell-state) and [here](#a-bell-state)");
});

test("feedback #60: a downloaded Markdown link into the KB is its text, one out of it stays", () => {
  assert.equal(exportBody("Read [the tests](/physics/bell-tests) first."), "Read the tests first.");
  assert.equal(exportBody("Read [the *tests*](/physics/bell-tests#loopholes \"Bell\")."), "Read the *tests*.");
  assert.equal(exportBody("A [sibling](bell-tests) and [a parent](../physics)."), "A sibling and a parent.");
  assert.equal(exportBody("[About [[id:bel00000000000]]](/physics)"), "About Bell tests");
  for (const kept of [
    "[Bell](https://en.wikipedia.org/wiki/Bell%27s_theorem)",
    "[Bell](<https://example.com/a b>)",
    "[mail](mailto:someone@example.com)",
    "[spec](_assets/spec.pdf)",
    "[up](#top)",
    "![A diagram](_assets/double-slit.svg =560x)",
  ]) {
    assert.equal(exportBody(kept), kept);
  }
  assert.equal(exportBody("[See [[id:bel00000000000]]](https://example.com)"), "[See Bell tests](https://example.com)");
});

test("feedback #60: a link written as code, or escaped, is left as it was written", () => {
  for (const kept of [
    "`[[id:bel00000000000]]` and ``[x](/physics) `[[y]]` ``",
    "\\[[id:bel00000000000]] and \\[x](/physics)",
    "```\n[[id:bel00000000000]] and [x](/physics)\n```",
    "~~~md\n[x](/physics)\n~~~",
  ]) {
    assert.equal(exportBody(kept), kept);
  }
  // A code span inside a link's text is part of the text.
  assert.equal(exportBody("Call [`kb_get_page`](/physics/bell-tests)."), "Call `kb_get_page`.");
  // Brackets that make no link are text.
  assert.equal(exportBody("$[\\hat{S}_x, \\hat{S}_y]$ and [x] (y) and [[open"), "$[\\hat{S}_x, \\hat{S}_y]$ and [x] (y) and [[open");
});
