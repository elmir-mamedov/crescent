import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { makeGit } from "./git.js";
import {
  LABELS_FILE,
  applyPageLabels,
  colorOf,
  createLabel,
  deleteLabel,
  knownLabels,
  labelledPages,
  loadLabelSet,
  spaceNodes,
  updateLabel,
} from "./labels.js";
import { git, makeTempKb, trySymlink, type TempKb } from "./test-helpers.js";

async function withSpace(
  run: (ctx: { kb: TempKb; content: Content; palette: string }) => Promise<void>
): Promise<void> {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    await content.createSpace("Docs");
    await run({ kb, content, palette: path.join(kb.dir, "docs", LABELS_FILE) });
  } finally {
    await kb.cleanup();
  }
}

async function labelsOf(content: Content, slug: string): Promise<string[] | undefined> {
  return (await content.load(slug))?.data.labels;
}

test("labels palette: a space without one has no labels", async () => {
  await withSpace(async ({ content }) => {
    assert.deepEqual(await loadLabelSet(content, "docs"), []);
    assert.deepEqual(await loadLabelSet(content, "../etc"), []);
  });
});

test("labels palette: createLabel writes pretty JSON that loads back", async () => {
  await withSpace(async ({ content, palette }) => {
    const created = await createLabel(content, "docs", "  Draft ", "yellow");
    assert.deepEqual(created, { changedFsPaths: [palette], name: "Draft" });
    await createLabel(content, "docs", "Needs review", "orange");

    assert.equal(
      await fs.readFile(palette, "utf8"),
      `{\n  "labels": [\n    {\n      "name": "Draft",\n      "color": "yellow"\n    },\n    {\n      "name": "Needs review",\n      "color": "orange"\n    }\n  ]\n}\n`
    );
    const set = await loadLabelSet(content, "docs");
    assert.deepEqual(set, [
      { name: "Draft", color: "yellow" },
      { name: "Needs review", color: "orange" },
    ]);
    assert.equal(colorOf(set, "draft"), "yellow");
    assert.equal(colorOf(set, "Unknown"), "gray");
  });
});

test("labels palette: duplicate names (any case) and unknown colours are refused", async () => {
  await withSpace(async ({ content }) => {
    await createLabel(content, "docs", "Draft", "yellow");
    await assert.rejects(() => createLabel(content, "docs", "DRAFT", "red"), /already exists/);
    await assert.rejects(() => createLabel(content, "docs", "Hot", "magenta"), /not one of/);
    await assert.rejects(() => createLabel(content, "docs", "a, b", "red"), /comma/);
  });
});

test("labels palette: a hand-written unknown colour reads as gray", async () => {
  await withSpace(async ({ content, palette }) => {
    await fs.writeFile(palette, JSON.stringify({ labels: [{ name: "Hot", color: "#ff0000" }] }));
    assert.deepEqual(await loadLabelSet(content, "docs"), [{ name: "Hot", color: "gray" }]);
  });
});

test("labels palette: a broken file renders as empty but blocks every mutation", async () => {
  await withSpace(async ({ content, palette }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    const broken = '{ "labels": [ { "name": "Draft", ';
    await fs.writeFile(palette, broken, "utf8");

    assert.deepEqual(await loadLabelSet(content, "docs"), []);
    await assert.rejects(() => createLabel(content, "docs", "New", "red"), /could not be read/);
    await assert.rejects(() => updateLabel(content, "docs", "Draft", { color: "red" }), /could not be read/);
    await assert.rejects(() => deleteLabel(content, "docs", "Draft"), /could not be read/);
    await assert.rejects(() => applyPageLabels(content, page.slug, []), /could not be read/);
    assert.equal(await fs.readFile(palette, "utf8"), broken);
  });
});

test("labels palette: the load cache notices a rewrite", async () => {
  await withSpace(async ({ content }) => {
    await createLabel(content, "docs", "Draft", "yellow");
    assert.equal((await loadLabelSet(content, "docs")).length, 1);
    await createLabel(content, "docs", "Done", "green");
    assert.equal((await loadLabelSet(content, "docs")).length, 2);
  });
});

test("applyPageLabels: matches the palette's spelling and creates a new label in one step", async () => {
  await withSpace(async ({ content, palette }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    await createLabel(content, "docs", "Draft", "yellow");

    const result = await applyPageLabels(content, page.slug, ["draft"], {
      name: "Needs review",
      color: "orange",
    });
    assert.deepEqual(result?.changedFsPaths, [palette, page.fsPath]);
    assert.deepEqual(await labelsOf(content, page.slug), ["Draft", "Needs review"]);
    assert.equal(colorOf(await loadLabelSet(content, "docs"), "Needs review"), "orange");

    // Naming an existing label in the "new" row just applies it.
    const again = await applyPageLabels(content, page.slug, [], { name: "DRAFT", color: "red" });
    assert.deepEqual(await labelsOf(content, page.slug), ["Draft"]);
    assert.deepEqual(again?.changedFsPaths, [page.fsPath]);
    assert.equal(colorOf(await loadLabelSet(content, "docs"), "Draft"), "yellow");
  });
});

test("applyPageLabels: an orphan already on the page may stay, an unknown new one may not", async () => {
  await withSpace(async ({ content, palette }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    await content.setLabels(page.slug, ["Legacy"]);
    await createLabel(content, "docs", "Draft", "yellow");

    await applyPageLabels(content, page.slug, ["Legacy", "Draft"]);
    assert.deepEqual(await labelsOf(content, page.slug), ["Legacy", "Draft"]);

    const before = await fs.readFile(palette, "utf8");
    await assert.rejects(
      () => applyPageLabels(content, page.slug, ["Invented"], { name: "Fresh", color: "red" }),
      /no label named "Invented"/
    );
    // The refused call wrote nothing — not even the label it would have created.
    assert.equal(await fs.readFile(palette, "utf8"), before);
    assert.deepEqual(await labelsOf(content, page.slug), ["Legacy", "Draft"]);
    assert.equal(await applyPageLabels(content, "docs/missing", []), null);
  });
});

test("updateLabel: a recolour touches only the palette", async () => {
  await withSpace(async ({ content, palette }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    await createLabel(content, "docs", "Draft", "yellow");
    await applyPageLabels(content, page.slug, ["Draft"]);

    const result = await updateLabel(content, "docs", "draft", { color: "blue" });
    assert.deepEqual(result.changedFsPaths, [palette]);
    assert.equal(colorOf(await loadLabelSet(content, "docs"), "Draft"), "blue");

    const unchanged = await updateLabel(content, "docs", "Draft", { name: "Draft", color: "blue" });
    assert.deepEqual(unchanged.changedFsPaths, []);
  });
});

test("updateLabel: a rename rewrites every page carrying it, archived ones too, in one commit", async () => {
  await withSpace(async ({ kb, content, palette }) => {
    const g = makeGit(kb.dir);
    const repo = path.join(kb.dir, "docs");
    await g.initSpaceRepo("docs");
    const live = await content.createPage("docs", "Live", "# Live\n");
    const hidden = await content.createPage("docs", "Hidden", "# Hidden\n");
    const other = await content.createPage("docs", "Other", "# Other\n");
    await createLabel(content, "docs", "Draft", "yellow");
    await createLabel(content, "docs", "Done", "green");
    await applyPageLabels(content, live.slug, ["Draft", "Done"]);
    await applyPageLabels(content, hidden.slug, ["Draft"]);
    await applyPageLabels(content, other.slug, ["Done"]);
    await content.updateArchive(hidden.slug, true);
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "Seed via test");

    const result = await updateLabel(content, "docs", "Draft", { name: "Work in progress" });
    assert.deepEqual(
      [...result.changedFsPaths].sort(),
      [palette, live.fsPath, hidden.fsPath].sort()
    );
    assert.deepEqual(await labelsOf(content, live.slug), ["Work in progress", "Done"]);
    assert.deepEqual(await labelsOf(content, hidden.slug), ["Work in progress"]);
    assert.deepEqual(await labelsOf(content, other.slug), ["Done"]);

    await g.commitFiles(result.changedFsPaths, "Rename label Draft to Work in progress in docs via test");
    const files = await git(repo, "show", "--name-only", "--format=", "HEAD");
    assert.deepEqual(
      files.split("\n").sort(),
      [LABELS_FILE, "hidden.md", "live.md"].sort()
    );
  });
});

test("updateLabel: a case-only rename is allowed, taking another label's name is not", async () => {
  await withSpace(async ({ content }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    await createLabel(content, "docs", "draft", "yellow");
    await createLabel(content, "docs", "Done", "green");
    await applyPageLabels(content, page.slug, ["draft"]);

    await updateLabel(content, "docs", "draft", { name: "Draft" });
    assert.deepEqual(await labelsOf(content, page.slug), ["Draft"]);
    await assert.rejects(() => updateLabel(content, "docs", "Draft", { name: "done" }), /already exists/);
  });
});

test("updateLabel: recolouring an orphan adds it to the palette", async () => {
  await withSpace(async ({ content, palette }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    await content.setLabels(page.slug, ["Legacy"]);
    const result = await updateLabel(content, "docs", "Legacy", { color: "brown" });
    assert.deepEqual(result.changedFsPaths, [palette]);
    assert.deepEqual(await loadLabelSet(content, "docs"), [{ name: "Legacy", color: "brown" }]);
  });
});

test("deleteLabel: removes it from the palette and from every page, archived ones too", async () => {
  await withSpace(async ({ content, palette }) => {
    const live = await content.createPage("docs", "Live", "# Live\n");
    const hidden = await content.createPage("docs", "Hidden", "# Hidden\n");
    await createLabel(content, "docs", "Draft", "yellow");
    await createLabel(content, "docs", "Done", "green");
    await applyPageLabels(content, live.slug, ["Draft", "Done"]);
    await applyPageLabels(content, hidden.slug, ["Draft"]);
    await content.updateArchive(hidden.slug, true);

    const result = await deleteLabel(content, "docs", "draft");
    assert.deepEqual(
      [...result.changedFsPaths].sort(),
      [palette, live.fsPath, hidden.fsPath].sort()
    );
    assert.deepEqual(await loadLabelSet(content, "docs"), [{ name: "Done", color: "green" }]);
    assert.deepEqual(await labelsOf(content, live.slug), ["Done"]);
    assert.equal(await labelsOf(content, hidden.slug), undefined);
    assert.doesNotMatch(await fs.readFile(hidden.fsPath, "utf8"), /labels/);
  });
});

test("deleteLabel: an orphan can be deleted; a name nobody uses is reported", async () => {
  await withSpace(async ({ content }) => {
    const page = await content.createPage("docs", "Deploy", "# Deploy\n");
    await content.setLabels(page.slug, ["Legacy"]);
    const result = await deleteLabel(content, "docs", "legacy");
    assert.deepEqual(result.changedFsPaths, [page.fsPath]);
    await assert.rejects(() => deleteLabel(content, "docs", "Nothing"), /No label named/);
  });
});

test("labelledPages: AND across the selection, in navigation order, space home included", async () => {
  await withSpace(async ({ content }) => {
    await createLabel(content, "docs", "Draft", "yellow");
    await createLabel(content, "docs", "Ops", "blue");
    const a = await content.createPage("docs", "Alpha", "# Alpha\n");
    const b = await content.createPage("docs", "Beta", "# Beta\n");
    await content.createPage("docs", "Gamma", "# Gamma\n");
    await applyPageLabels(content, "docs", ["Ops"]);
    await applyPageLabels(content, a.slug, ["Draft", "Ops"]);
    await applyPageLabels(content, b.slug, ["Draft"]);

    const slugs = async (selected: string[]) =>
      (await labelledPages(content, "docs", "live", selected)).map((n) => n.slug);
    const order = (await spaceNodes(content, "docs", "live")).map((n) => n.slug);
    const inOrder = (xs: string[]) => order.filter((s) => xs.includes(s));

    assert.deepEqual(await slugs(["draft"]), inOrder([a.slug, b.slug]));
    assert.deepEqual(await slugs(["Draft", "Ops"]), [a.slug]);
    assert.deepEqual(await slugs(["Ops"]), inOrder(["docs", a.slug]));
    assert.deepEqual(await slugs([]), inOrder(["docs", a.slug, b.slug]));
    assert.deepEqual(await slugs(["Nope"]), []);
  });
});

test("labelledPages: archived pages appear only under the wider filter", async () => {
  await withSpace(async ({ content }) => {
    await createLabel(content, "docs", "Draft", "yellow");
    const page = await content.createPage("docs", "Alpha", "# Alpha\n");
    await applyPageLabels(content, page.slug, ["Draft"]);
    await content.updateArchive(page.slug, true);

    assert.deepEqual(await labelledPages(content, "docs", "live", ["Draft"]), []);
    assert.equal((await labelledPages(content, "docs", "all", ["Draft"])).length, 1);
  });
});

test("knownLabels: palette first with counts, then orphans in grey", async () => {
  await withSpace(async ({ content }) => {
    await createLabel(content, "docs", "Draft", "yellow");
    await createLabel(content, "docs", "Unused", "red");
    const a = await content.createPage("docs", "Alpha", "# Alpha\n");
    const b = await content.createPage("docs", "Beta", "# Beta\n");
    await applyPageLabels(content, a.slug, ["Draft"]);
    await content.setLabels(b.slug, ["zeta", "Legacy", "draft"]);

    const known = knownLabels(
      await loadLabelSet(content, "docs"),
      await spaceNodes(content, "docs", "live")
    );
    assert.deepEqual(known, [
      { name: "Draft", color: "yellow", defined: true, count: 2 },
      { name: "Unused", color: "red", defined: true, count: 0 },
      { name: "Legacy", color: "gray", defined: false, count: 1 },
      { name: "zeta", color: "gray", defined: false, count: 1 },
    ]);
  });
});

test("labels palette: a palette that is a symbolic link is neither read nor written through", async (t) => {
  await withSpace(async ({ content, palette }) => {
    const elsewhere = await makeTempKb();
    try {
      const target = path.join(elsewhere.dir, "outside.json");
      const original = `{ "labels": [{ "name": "Outside", "color": "red" }] }\n`;
      await fs.writeFile(target, original);
      if (!(await trySymlink(target, palette, "file"))) return t.skip("no file links here");

      assert.deepEqual(await loadLabelSet(content, "docs"), []);
      await assert.rejects(() => createLabel(content, "docs", "Draft", "yellow"), /does not follow symbolic links/);
      assert.equal(await fs.readFile(target, "utf8"), original);
    } finally {
      await elsewhere.cleanup();
    }
  });
});
