import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_SPACE, examplesRoot, offerExampleSpace } from "./example-space.js";
import { parsePage } from "./frontmatter.js";
import { createRenderer, extractSections } from "./markdown.js";
import { mathProblems } from "./math-normalize.js";
import { parseNotes } from "./notes.js";
import { makeTempKb } from "./test-helpers.js";

const ROOT = examplesRoot(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SPACE_DIR = path.join(ROOT, EXAMPLE_SPACE);

/** A git that records what it was asked to do. */
function fakeGit() {
  const calls: { init: string[]; commits: { files: string[]; message: string }[] } = { init: [], commits: [] };
  return {
    calls,
    initSpaceRepo: async (key: string) => {
      calls.init.push(key);
    },
    commitFiles: async (files: string[], message: string) => {
      calls.commits.push({ files, message });
      return "abc123";
    },
  };
}

test("feedback #49: a knowledge base with no spaces gets the example space once, committed", async () => {
  const kb = await makeTempKb();
  try {
    const git = fakeGit();
    assert.equal(await offerExampleSpace(kb.dir, ROOT, git), EXAMPLE_SPACE);
    assert.ok(fs.existsSync(path.join(kb.dir, EXAMPLE_SPACE, "index.md")));
    assert.deepEqual(git.calls.init, [EXAMPLE_SPACE]);
    const committed = git.calls.commits[0].files.map((file) => path.relative(path.join(kb.dir, EXAMPLE_SPACE), file));
    assert.ok(committed.includes("index.md") && committed.includes(path.join("_assets", "chain-of-springs.html")));
    // The .gitignore every new space gets, so its search index is never committed.
    assert.ok(committed.includes(".gitignore"));
    assert.ok(committed.every((file) => !file.startsWith(`.git${path.sep}`)), "git's own files are not committed");

    // Deleted, it stays deleted.
    fs.rmSync(path.join(kb.dir, EXAMPLE_SPACE), { recursive: true });
    assert.equal(await offerExampleSpace(kb.dir, ROOT, git), null);
    assert.equal(git.calls.commits.length, 1);
  } finally {
    await kb.cleanup();
  }
});

test("feedback #49: a knowledge base that already has spaces never gets the example space", async () => {
  const kb = await makeTempKb();
  try {
    fs.mkdirSync(path.join(kb.dir, "notes"));
    fs.writeFileSync(path.join(kb.dir, "notes", "index.md"), "---\ntitle: Notes\n---\n");
    const git = fakeGit();
    assert.equal(await offerExampleSpace(kb.dir, ROOT, git), null);
    fs.rmSync(path.join(kb.dir, "notes"), { recursive: true });
    // Emptied later, it still doesn't: crescent looked once.
    assert.equal(await offerExampleSpace(kb.dir, ROOT, git), null);
    assert.ok(!fs.existsSync(path.join(kb.dir, EXAMPLE_SPACE)));
    assert.deepEqual(git.calls.commits, []);
  } finally {
    await kb.cleanup();
  }
});

/** Every Markdown page in the example space. */
function examplePages() {
  return fs
    .readdirSync(SPACE_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return { file, ...parsePage(fs.readFileSync(file, "utf8"), file) };
    });
}

test("feedback #49: the example space's links, sections, files, labels, notes and math all hold", () => {
  const pages = examplePages();
  const byId = new Map<string, (typeof pages)[number]>();
  for (const page of pages) {
    assert.ok(page.data.id, `${page.file} has no id`);
    assert.ok(!byId.has(page.data.id!), `${page.file} reuses the id ${page.data.id}`);
    byId.set(page.data.id!, page);
  }
  const palette: string[] = JSON.parse(fs.readFileSync(path.join(SPACE_DIR, "_labels.json"), "utf8")).labels.map(
    (label: { name: string }) => label.name
  );

  let links = 0;
  let notes = 0;
  for (const page of pages) {
    for (const [, id, anchor] of page.body.matchAll(/\[\[id:([a-z0-9]+)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]/g)) {
      links++;
      const target = byId.get(id);
      assert.ok(target, `${page.file} links to a missing page ${id}`);
      if (anchor) {
        const anchors = extractSections(target.body).map((section) => section.anchor);
        assert.ok(anchors.includes(anchor), `${page.file} links to a missing section ${id}#${anchor}`);
      }
    }
    for (const [, asset] of page.body.matchAll(/\]\((_assets\/[^\s)]+)/g)) {
      assert.ok(fs.existsSync(path.join(SPACE_DIR, asset)), `${page.file} uses a missing ${asset}`);
    }
    for (const label of page.data.labels ?? []) {
      assert.ok(palette.includes(label), `${page.file} has the label ${label}, which the space has no colour for`);
    }
    for (const note of parseNotes(page.body)) {
      notes++;
      const below = page.body.slice(page.body.indexOf(`id=${note.id}`)).replace(/\s+/g, " ").replace(/\*\*/g, "");
      assert.ok(note.quote && below.includes(note.quote), `a note in ${page.file} quotes text that isn't on the page`);
    }
    assert.deepEqual(mathProblems(page.body), [], `${page.file} has math that won't render`);
    const html = createRenderer(
      () => "Title",
      path.relative(ROOT, page.file).replace(/\\/g, "/").replace(/(\/index)?\.md$/, ""),
      (id) => (byId.has(id) ? "x" : undefined)
    ).render(page.body);
    assert.doesNotMatch(html, /katex-error|wikilink broken/, `${page.file} renders an error or a broken link`);
  }
  assert.ok(links > 20 && notes >= 2, "found too few links or notes to check");
});
