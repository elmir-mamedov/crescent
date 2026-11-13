import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { Content } from "./content.js";
import { downloadFilename, downloadPage, exportMarkdown, type ExportContext } from "./page-export.js";
import { crc32 } from "./zip.js";
import { makeTempKb } from "./test-helpers.js";

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
  return exportMarkdown(raw, context(slug)).markdown;
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

/** The files a titled page at `slug` uses, as the export finds them. */
function exportAssets(body: string, slug?: string): string[] {
  return exportMarkdown(`---\ntitle: T\n---\n${body}\n`, context(slug)).assets;
}

test("feedback #60: a downloaded page names its own files as _assets/, and lists them", () => {
  const kept = "![The slits](_assets/double-slit.svg) and [the data](_assets/runs/2026.csv \"Runs\")";
  assert.equal(exportBody(kept), kept);
  assert.deepEqual(exportAssets(kept), ["double-slit.svg", "runs/2026.csv"]);
  // The same folder reached another way is the same file, and named the portable way.
  assert.equal(
    exportBody("![a](/physics/_assets/a%20b.png \"A\") [b](../_assets/b.pdf)", "physics/measurement/uncertainty"),
    "![a](_assets/a%20b.png \"A\") [b](_assets/b.pdf)"
  );
  // One that misses the space's folder shows nothing on the page either.
  assert.equal(exportBody("![c](./_assets/c.png)", "physics/measurement/uncertainty"), "![c](./_assets/c.png)");
  assert.deepEqual(exportAssets("![c](./_assets/c.png)", "physics/measurement/uncertainty"), []);
  assert.deepEqual(
    exportAssets("![a](_assets/a%20b.png) ![again](_assets/a%20b.png?v=2#x) ![c](<_assets/c d.png>)"),
    ["a b.png", "c d.png"]
  );
  // Another space's files are not this page's: a link to one is its text, an
  // image of one stays as written, and neither goes with the page.
  assert.equal(exportBody("[their file](/notes/_assets/x.pdf) ![theirs](/notes/_assets/x.png)"), "their file ![theirs](/notes/_assets/x.png)");
  assert.deepEqual(exportAssets("[their file](/notes/_assets/x.pdf) ![x](https://example.com/x.png)"), []);
  // A file named in code is an example, not one the page uses.
  assert.deepEqual(exportAssets("`![a](_assets/a.png)`\n```\n![b](_assets/b.png)\n```"), []);
});

test("feedback #60: a downloaded image sized with =WxH is an <img> of that size", () => {
  assert.equal(
    exportBody("![Two slits](_assets/double-slit.svg =560x)"),
    '<img src="_assets/double-slit.svg" alt="Two slits" width="560">'
  );
  assert.equal(
    exportBody('![A \\[b\\] & "c"](/physics/_assets/x.png "The <title>" =x300)'),
    '<img src="_assets/x.png" alt="A [b] &amp; &quot;c&quot;" title="The &lt;title&gt;" height="300">'
  );
  assert.equal(
    exportBody("[![logo](https://example.com/l.png =32x32)](https://example.com)"),
    '[<img src="https://example.com/l.png" alt="logo" width="32" height="32">](https://example.com)'
  );
  // `=x` sizes nothing, so the renderer reads no image there, and neither does this.
  assert.equal(exportBody("![a](_assets/a.png =x)"), "![a](_assets/a.png =x)");
});

/** The files in a zip archive, read the way an unzip tool reads them, CRCs checked. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "no end of central directory");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50);
    assert.equal(archive.readUInt16LE(at + 8) & 0x0800, 0x0800, "name not marked UTF-8");
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extra = archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    assert.equal(archive.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const body = archive.subarray(start, start + archive.readUInt32LE(offset + 18));
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size, `${name}: size`);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    files.set(name, data);
    at += 46 + nameLength + extra;
  }
  return files;
}

test("crc32 is zip's checksum", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("feedback #60: a page that shows its own files downloads as a zip of it and them", async () => {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    await fs.mkdir(path.join(kb.dir, "physics", "_assets", "runs"), { recursive: true });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const csv = Buffer.from("run,s\n".repeat(200));
    await fs.writeFile(path.join(kb.dir, "physics", "_assets", "Šrödinger plot.png"), png);
    await fs.writeFile(path.join(kb.dir, "physics", "_assets", "runs", "2026.csv"), csv);
    await fs.writeFile(path.join(kb.dir, "physics", "_assets", ".hidden.png"), png);
    const raw = [
      "---",
      "title: Bell tests",
      "---",
      "![Plot](_assets/%C5%A0r%C3%B6dinger%20plot.png =400x)",
      "",
      "[Runs](_assets/runs/2026.csv), [missing](_assets/gone.png), [hidden](_assets/.hidden.png),",
      "[escape](_assets/../../secret.txt) and ![again](_assets/%C5%A0r%C3%B6dinger%20plot.png).",
      "",
    ].join("\n");
    const download = await downloadPage(content, raw, context("physics/bell-tests"));
    assert.equal(download.filename, "bell-tests.zip");
    assert.equal(download.contentType, "application/zip");
    const files = unzip(download.body as Buffer);
    assert.deepEqual([...files.keys()], ["bell-tests.md", "_assets/Šrödinger plot.png", "_assets/runs/2026.csv"]);
    assert.deepEqual(files.get("_assets/Šrödinger plot.png"), png);
    assert.deepEqual(files.get("_assets/runs/2026.csv"), csv);
    assert.equal(
      files.get("bell-tests.md")!.toString("utf8"),
      exportMarkdown(raw, context("physics/bell-tests")).markdown
    );
  } finally {
    await kb.cleanup();
  }
});

test("feedback #60: a page with no files of its own, or none that are there, downloads as .md", async () => {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    for (const body of ["Just text, and [a link](https://example.com).", "![Gone](_assets/gone.png)"]) {
      const download = await downloadPage(content, `---\ntitle: Bell tests\n---\n${body}\n`, context("physics/bell-tests"));
      assert.equal(download.filename, "bell-tests.md");
      assert.equal(download.contentType, "text/markdown; charset=utf-8");
      assert.equal(download.body, `# Bell tests\n\n${body}\n`);
    }
  } finally {
    await kb.cleanup();
  }
});
