import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { readImageFile } from "./gallery.js";
import { makeGit } from "./git.js";
import { makeKbWrites, type KbWrites } from "./kb-writes.js";
import { git, isGitRepo, makeTempKb, type TempKb } from "./test-helpers.js";

/** A throwaway KB with one space, "Docs", already committed, and writes signed `via test`. */
async function withSpace(
  run: (ctx: { kb: TempKb; content: Content; writes: KbWrites; repo: string }) => Promise<void>
): Promise<void> {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    const writes = makeKbWrites({ content, git: makeGit(kb.dir), via: "test" });
    const space = await writes.createSpace("Docs");
    assert.equal(space.commitError, undefined);
    await run({ kb, content, writes, repo: path.join(kb.dir, "docs") });
  } finally {
    await kb.cleanup();
  }
}

async function subjects(repo: string): Promise<string[]> {
  return (await git(repo, "log", "--format=%s")).split("\n");
}

test("createSpace makes the space its own repo and commits its scaffolding", async () => {
  await withSpace(async ({ repo }) => {
    assert.equal(await isGitRepo(repo), true);
    assert.deepEqual(await subjects(repo), ["Create docs/index.md via test"]);
    assert.equal(await git(repo, "status", "--porcelain"), "");
  });
});

test("createPage commits the new page under the writer's via", async () => {
  await withSpace(async ({ writes, repo }) => {
    const written = await writes.createPage("docs", "Deploy", "# Deploy\n");
    assert.ok(written.commit);
    assert.equal(written.mutation.slug, "docs/deploy");
    assert.equal((await subjects(repo))[0], "Create docs/deploy.md via test");
  });
});

test("createPage under a leaf commits the leaf's promotion into a section too", async () => {
  await withSpace(async ({ writes, repo }) => {
    await writes.createPage("docs", "Runbooks", "# Runbooks\n");
    const child = await writes.createPage("docs/runbooks", "Deploy", "# Deploy\n");
    assert.equal(child.mutation.slug, "docs/runbooks/deploy");
    // runbooks.md moved to runbooks/index.md: nothing is left behind uncommitted.
    assert.equal(await git(repo, "status", "--porcelain"), "");
    assert.equal((await subjects(repo))[0], "Create docs/runbooks/deploy.md via test");
  });
});

test("savePage lands an edit and a slug change in one commit", async () => {
  await withSpace(async ({ content, writes, repo }) => {
    const page = await writes.createPage("docs", "Draft", "Old text\n");
    const raw = (await content.loadRaw(page.mutation.slug))!.raw.replace("Old text", "New text");

    const written = await writes.savePage("docs/draft", raw, "final");
    assert.ok(written);
    assert.equal(written.mutation.renamed?.newSlug, "docs/final");
    assert.equal(written.mutation.renameError, undefined);
    assert.equal(await git(repo, "status", "--porcelain"), "");
    assert.equal((await subjects(repo))[0], "Rename docs/draft to docs/final via test");
    // The rename commit carries the edit, so the renamed page's diff shows it.
    assert.match(await git(repo, "show", "HEAD", "--", "final.md"), /\+New text/);
  });
});

test("savePage commits the edit even when the slug change is refused", async () => {
  await withSpace(async ({ content, writes, repo }) => {
    await writes.createPage("docs", "Draft", "Old text\n");
    const raw = (await content.loadRaw("docs/draft"))!.raw.replace("Old text", "New text");

    const written = await writes.savePage("docs/draft", raw, "!!!");
    assert.ok(written);
    assert.equal(written.mutation.renamed, null);
    assert.match(written.mutation.renameError ?? "", /letters or numbers/);
    assert.equal(await git(repo, "status", "--porcelain"), "");
    assert.equal((await subjects(repo))[0], "Update docs/draft.md via test");
  });
});

test("savePage with the same slug is a plain update", async () => {
  await withSpace(async ({ content, writes, repo }) => {
    await writes.createPage("docs", "Draft", "Old text\n");
    const raw = (await content.loadRaw("docs/draft"))!.raw.replace("Old text", "New text");

    const written = await writes.savePage("docs/draft", raw, "draft");
    assert.equal(written?.mutation.renamed, null);
    assert.equal((await subjects(repo))[0], "Update docs/draft.md via test");
  });
});

test("writes that change nothing commit nothing", async () => {
  await withSpace(async ({ writes, repo }) => {
    await writes.createFolder("docs", "Guides");
    const before = await subjects(repo);

    const folder = await writes.renameFolder("docs/guides", "Guides");
    assert.ok(folder);
    assert.equal(folder.commit, null);
    const page = await writes.renamePage("docs/guides", "guides");
    assert.equal(page?.commit, null);
    const space = await writes.renameSpace("docs", "Docs");
    assert.equal(space?.commit, null);

    assert.deepEqual(await subjects(repo), before);
  });
});

test("a missing page is null, not a throw", async () => {
  await withSpace(async ({ writes }) => {
    assert.equal(await writes.updatePage("docs/nope", "---\ntitle: Nope\n---\n"), null);
    assert.equal(await writes.setArchived("docs/nope", true), null);
    assert.equal(await writes.deletePage("docs/nope"), null);
    assert.equal(await writes.movePage("docs/nope", null), null);
  });
});

test("archive, restore and delete name a single page by its file", async () => {
  await withSpace(async ({ writes, repo }) => {
    await writes.createPage("docs", "Old", "# Old\n");
    await writes.setArchived("docs/old", true);
    await writes.setArchived("docs/old", false);
    await writes.deletePage("docs/old");
    assert.deepEqual((await subjects(repo)).slice(0, 3), [
      "Delete docs/old.md via test",
      "Restore docs/old.md via test",
      "Archive docs/old.md via test",
    ]);
  });
});

test("updateLabel names a rename and a recolour in one subject", async () => {
  await withSpace(async ({ writes, repo }) => {
    await writes.createLabel("docs", "Draft", "yellow");
    await writes.updateLabel("docs", "Draft", { name: "Review", color: "green" });
    await writes.updateLabel("docs", "Review", { color: "red" });
    assert.deepEqual((await subjects(repo)).slice(0, 3), [
      "Recolor label Review in docs via test",
      "Rename and recolor label Draft to Review in docs via test",
      "Create label Draft in docs via test",
    ]);
  });
});

test("a commit that fails leaves the write in place and reports why", async () => {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    const real = makeGit(kb.dir);
    const failing = {
      ...real,
      commitFiles: async () => {
        throw new Error("index.lock exists");
      },
    };
    await makeKbWrites({ content, git: real, via: "test" }).createSpace("Docs");
    const writes = makeKbWrites({ content, git: failing, via: "test" });

    const written = await writes.createPage("docs", "Deploy", "# Deploy\n");
    assert.equal(written.commit, null);
    assert.equal(written.commitError, "index.lock exists");
    assert.equal(written.mutation.slug, "docs/deploy");
    assert.ok(await content.loadRaw("docs/deploy"), "the page is still on disk");
  } finally {
    await kb.cleanup();
  }
});

test("addImages commits an image read from disk, and a second copy under a name of its own", async () => {
  await withSpace(async ({ kb, writes, repo }) => {
    const source = path.join(kb.dir, "plot.png");
    await fs.writeFile(source, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const first = await writes.addImages("docs", [await readImageFile(source)]);
    const second = await writes.addImages("docs", [await readImageFile(source)]);
    assert.deepEqual(
      [...first.mutation.saved, ...second.mutation.saved].map((image) => image.path),
      ["plot.png", "plot-2.png"]
    );
    assert.deepEqual((await subjects(repo)).slice(0, 2), [
      "Add docs/_assets/plot-2.png via test",
      "Add docs/_assets/plot.png via test",
    ]);
    assert.equal(await git(repo, "status", "--porcelain"), "");
  });
});
