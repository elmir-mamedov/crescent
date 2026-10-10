import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Content } from "./content.js";
import { makeGit } from "./git.js";
import { makeTempKb, git, isGitRepo, type TempKb } from "./test-helpers.js";

/** Create a space folder that is its own initialized git repo with one commit. */
async function seedSpace(kbDir: string, title: string) {
  const content = new Content(kbDir);
  const g = makeGit(kbDir);
  const mutation = await content.createSpace(title);
  await g.initSpaceRepo(mutation.slug);
  await g.commitFiles(
    mutation.changedFsPaths ?? [mutation.fsPath],
    `Create ${g.kbRelPath(mutation.fsPath)} via test`
  );
  return { content, g, slug: mutation.slug };
}

test("commitFiles commits a new page inside its space repo", async () => {
  const kb: TempKb = await makeTempKb();
  try {
    const { content, g, slug } = await seedSpace(kb.dir, "Engineering");
    const created = await content.createPage(slug, "Deploy Runbook", "# Deploy\n");
    const sha = await g.commitFiles([created.fsPath], "Create page via test");

    assert.ok(sha, "expected a commit sha");
    const log = await git(path.join(kb.dir, slug), "log", "--oneline");
    assert.match(log, /Create page via test/);
  } finally {
    await kb.cleanup();
  }
});

test("renaming a space does not fail the git commit (issue #2)", async () => {
  const kb: TempKb = await makeTempKb();
  try {
    const { content, g, slug } = await seedSpace(kb.dir, "My Space");
    assert.equal(slug, "my-space");

    // Reproduce the reported flow: rename the freshly created space, then run
    // the same commit the web/MCP layer runs after a rename.
    const renamed = await content.renamePage(slug, "renamed");
    assert.ok(renamed);
    assert.equal(renamed!.newSlug, "renamed");

    // Previously this threw "Refusing to commit a file outside its space repo."
    await assert.doesNotReject(
      () => g.commitMovedPaths(renamed!.changedFsPaths, `Rename ${renamed!.oldSlug} to ${renamed!.newSlug} via test`),
      "renaming a space must not fail the commit"
    );

    // The folder moved wholesale, carrying its .git with it: the new location is
    // still a valid repo and its history survives.
    assert.equal(await isGitRepo(path.join(kb.dir, "renamed")), true);
    assert.equal(await isGitRepo(path.join(kb.dir, "my-space")), false);
    const log = await git(path.join(kb.dir, "renamed"), "log", "--oneline");
    assert.match(log, /Create .*index\.md via test/);
  } finally {
    await kb.cleanup();
  }
});

test("renaming a space also commits an index.md content edit made in the same save", async () => {
  const kb: TempKb = await makeTempKb();
  try {
    const { content, g, slug } = await seedSpace(kb.dir, "My Space");

    // Mirror the web edit flow: content is saved first, then the slug changes.
    const edited = "---\ntitle: My Space\n---\n\n# My Space\n\nNow with a body.\n";
    await content.updateRaw(slug, edited);
    const renamed = await content.renamePage(slug, "renamed");
    assert.ok(renamed);

    const sha = await g.commitMovedPaths(
      renamed!.changedFsPaths,
      `Rename ${renamed!.oldSlug} to ${renamed!.newSlug} via test`
    );
    assert.ok(sha, "the index.md content edit should produce a commit");

    const repo = path.join(kb.dir, "renamed");
    const status = await git(repo, "status", "--porcelain");
    assert.equal(status, "", "working tree must be clean — the edit was committed");
    const head = await git(repo, "log", "-1", "--format=%s");
    assert.equal(head, "Rename my-space to renamed via test");
    const committed = await git(repo, "show", "HEAD:index.md");
    assert.match(committed, /Now with a body\./);
  } finally {
    await kb.cleanup();
  }
});

test("commitMovedPaths still commits real file moves alongside a space-root no-op", async () => {
  const kb: TempKb = await makeTempKb();
  try {
    const { content, g, slug } = await seedSpace(kb.dir, "Docs");
    // A normal in-space rename (leaf page) must keep working: the folder-root
    // skip only applies to paths that ARE a repo root.
    const created = await content.createPage(slug, "Notes", "# Notes\n");
    await g.commitFiles([created.fsPath], "Create notes via test");

    const renamed = await content.renamePage(created.slug, "meeting-notes");
    assert.ok(renamed);
    const sha = await g.commitMovedPaths(
      renamed!.changedFsPaths,
      `Rename ${renamed!.oldSlug} to ${renamed!.newSlug} via test`
    );
    assert.ok(sha, "a real file rename should still produce a commit");

    assert.equal(await fs.readFile(path.join(kb.dir, slug, "meeting-notes.md"), "utf8").then(() => true), true);
    const status = await git(path.join(kb.dir, slug), "status", "--porcelain");
    assert.equal(status, "", "working tree should be clean after committing the rename");
  } finally {
    await kb.cleanup();
  }
});

/** Run `fn` with some env vars overridden, restoring the originals afterwards. */
async function withEnv(overrides: Record<string, string>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("without git, a space can still be created and saved, just uncommitted", async () => {
  const kb: TempKb = await makeTempKb();
  const emptyBin = await fs.mkdtemp(path.join(os.tmpdir(), "kb25-nogit-"));
  try {
    let slug = "";
    await withEnv({ PATH: emptyBin }, async () => {
      const content = new Content(kb.dir);
      const g = makeGit(kb.dir);
      const mutation = await content.createSpace("Notes");
      slug = mutation.slug;
      await g.initSpaceRepo(slug);
      const created = await content.createPage(slug, "First", "# First\n");
      assert.equal(await g.commitFiles([created.fsPath], "Create page via test"), null);
      assert.deepEqual(await g.fileCommits(created.fsPath), []);
    });
    assert.equal(await isGitRepo(path.join(kb.dir, slug)), false);
  } finally {
    await kb.cleanup();
    await fs.rm(emptyBin, { recursive: true, force: true });
  }
});

test("a new space repo gets a local git identity only when none is configured", async () => {
  const kb: TempKb = await makeTempKb();
  const cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), "kb25-gitcfg-"));
  const localEmail = async (slug: string) => {
    try {
      return await git(path.join(kb.dir, slug), "config", "--local", "user.email");
    } catch {
      return "";
    }
  };
  try {
    const empty = path.join(cfgDir, "empty");
    await fs.writeFile(empty, "");
    await withEnv({ GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1" }, async () => {
      const { slug } = await seedSpace(kb.dir, "Fresh Laptop");
      assert.equal(await localEmail(slug), "kb25@localhost");
    });

    const configured = path.join(cfgDir, "configured");
    await fs.writeFile(configured, "[user]\n\tname = Me\n\temail = me@example.com\n");
    await withEnv({ GIT_CONFIG_GLOBAL: configured, GIT_CONFIG_NOSYSTEM: "1" }, async () => {
      const { slug } = await seedSpace(kb.dir, "Dev Laptop");
      assert.equal(await localEmail(slug), "");
    });
  } finally {
    await kb.cleanup();
    await fs.rm(cfgDir, { recursive: true, force: true });
  }
});
