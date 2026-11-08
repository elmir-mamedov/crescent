import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installedKbDir, resetDevKb, sameDir, SEED_DIR } from "./dev-kb.js";
import { parsePage } from "./frontmatter.js";
import { extractSections } from "./markdown.js";
import { parseNotes } from "./notes.js";
import { git, makeTempKb } from "./test-helpers.js";

const seedSpaces = fs
  .readdirSync(SEED_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** Every Markdown page in the sample KB, with the space it is in. */
function seedPages(): { space: string; file: string; raw: string }[] {
  return seedSpaces.flatMap((space) =>
    fs
      .readdirSync(path.join(SEED_DIR, space), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return { space, file, raw: fs.readFileSync(file, "utf8") };
      })
  );
}

test("the sample KB's links, images, labels and notes all resolve", () => {
  const pages = seedPages().map((page) => ({ ...page, ...parsePage(page.raw, page.file) }));
  const byId = new Map<string, (typeof pages)[number]>();
  for (const page of pages) {
    assert.ok(page.data.id, `${page.file} has no id`);
    assert.ok(!byId.has(page.data.id!), `${page.file} reuses the id ${page.data.id}`);
    byId.set(page.data.id!, page);
  }

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
      assert.ok(fs.existsSync(path.join(SEED_DIR, page.space, asset)), `${page.file} shows a missing ${asset}`);
    }
    const palette = fs.existsSync(path.join(SEED_DIR, page.space, "_labels.json"))
      ? JSON.parse(fs.readFileSync(path.join(SEED_DIR, page.space, "_labels.json"), "utf8")).labels.map(
          (label: { name: string }) => label.name
        )
      : [];
    for (const label of page.data.labels ?? []) {
      assert.ok(palette.includes(label), `${page.file} has the label ${label}, which ${page.space} has no colour for`);
    }
    for (const note of parseNotes(page.body)) {
      notes++;
      assert.ok(!note.id.startsWith("@"), `a note in ${page.file} has no id`);
      const below = page.body.slice(page.body.indexOf(`id=${note.id}`)).replace(/\s+/g, " ");
      assert.ok(note.quote && below.includes(note.quote), `a note in ${page.file} quotes text that isn't on the page`);
    }
  }
  assert.ok(links > 0 && notes > 0, "found no links or notes to check");
});

test("resetDevKb makes each sample space a git repo with one commit", async () => {
  const tmp = await makeTempKb();
  try {
    const kbDir = path.join(tmp.dir, "kb");
    assert.deepEqual(await resetDevKb(kbDir, { installedKb: null }), seedSpaces);
    for (const space of seedSpaces) {
      const repo = path.join(kbDir, space);
      assert.equal(await git(repo, "rev-list", "--count", "HEAD"), "1");
      assert.equal(await git(repo, "status", "--porcelain"), "");
    }
  } finally {
    await tmp.cleanup();
  }
});

test("resetDevKb replaces a KB it made, and refuses one it didn't", async () => {
  const tmp = await makeTempKb();
  try {
    const sample = path.join(tmp.dir, "sample");
    await resetDevKb(sample, { installedKb: null });
    fs.writeFileSync(path.join(sample, seedSpaces[0], "trial.md"), "---\ntitle: Trial\n---\n");
    await resetDevKb(sample, { installedKb: null });
    assert.ok(!fs.existsSync(path.join(sample, seedSpaces[0], "trial.md")));

    const real = path.join(tmp.dir, "real");
    fs.mkdirSync(path.join(real, "notes"), { recursive: true });
    fs.writeFileSync(path.join(real, "notes", "index.md"), "---\ntitle: Notes\n---\n");
    await assert.rejects(resetDevKb(real, { installedKb: null }), /didn't put there/);
    assert.ok(fs.existsSync(path.join(real, "notes", "index.md")));
  } finally {
    await tmp.cleanup();
  }
});

test("resetDevKb never deletes the installed copy's KB, even one it made", async () => {
  const tmp = await makeTempKb();
  try {
    const kbDir = path.join(tmp.dir, "kb");
    await resetDevKb(kbDir, { installedKb: null });
    await assert.rejects(resetDevKb(kbDir, { installedKb: kbDir }), /installed Crescent/);
    assert.ok(fs.existsSync(path.join(kbDir, seedSpaces[0], "index.md")));
  } finally {
    await tmp.cleanup();
  }
});

test("resetDevKb with ifMissing makes a KB only where there is none", async () => {
  const tmp = await makeTempKb();
  try {
    const kbDir = path.join(tmp.dir, "kb");
    assert.deepEqual(await resetDevKb(kbDir, { ifMissing: true, installedKb: null }), seedSpaces);

    const real = path.join(tmp.dir, "real");
    fs.mkdirSync(path.join(real, "notes"), { recursive: true });
    // Even the installed copy's KB: the server refuses that one, with a way past.
    assert.equal(await resetDevKb(real, { ifMissing: true, installedKb: real }), null);
    assert.deepEqual(fs.readdirSync(real), ["notes"]);
  } finally {
    await tmp.cleanup();
  }
});

test("installedKbDir reads the KB_DIR an installed copy's .env names", async () => {
  const tmp = await makeTempKb();
  try {
    const home = path.join(tmp.dir, "KB25");
    assert.equal(installedKbDir({ KB25_HOME: home }), null);
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".env"), `PORT=25250\nKB_DIR=${path.join(tmp.dir, "Crescent")}\n`);
    assert.equal(installedKbDir({ KB25_HOME: home }), path.join(tmp.dir, "Crescent"));
  } finally {
    await tmp.cleanup();
  }
});

test("sameDir matches one folder however it is named, and nothing else", async () => {
  const tmp = await makeTempKb();
  try {
    const a = path.join(tmp.dir, "a");
    const b = path.join(tmp.dir, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    assert.ok(sameDir(a, path.join(b, "..", "a")));
    assert.ok(!sameDir(a, b));
    assert.ok(sameDir(path.join(tmp.dir, "missing"), path.join(tmp.dir, "missing")));
    assert.ok(!sameDir(a, path.join(tmp.dir, "missing")));
  } finally {
    await tmp.cleanup();
  }
});
