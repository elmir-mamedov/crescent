import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ChangeFeed, changedSlug, type ChangeBatch } from "./changes.js";
import { makeTempKb } from "./test-helpers.js";

/** The next batch the feed hands out, or a failure once `ms` pass without one. */
function nextBatch(feed: ChangeFeed, ms = 2000): Promise<ChangeBatch> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`no batch within ${ms}ms`));
    }, ms);
    const stop = feed.subscribe((batch) => {
      clearTimeout(timer);
      stop();
      resolve(batch);
    });
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a changed path names the page or folder it is", () => {
  assert.equal(changedSlug("docs/runbooks/deploy.md"), "docs/runbooks/deploy");
  assert.equal(changedSlug(path.join("docs", "runbooks", "index.md")), "docs/runbooks");
  assert.equal(changedSlug("docs/index.md"), "docs");
  assert.equal(changedSlug("docs/runbooks"), "docs/runbooks");
  // Git's, the viewer's own, assets, palettes, swap and temporary files.
  for (const ignored of [
    "docs/.git/index",
    ".kb25/chat/thread.json",
    "docs/_assets/diagram.png",
    "docs/_assets",
    "docs/_labels.json",
    "docs/.deploy.md.swp",
    "docs/deploy.md~",
    "docs/deploy.md.tmp-123",
  ]) {
    assert.equal(changedSlug(ignored), null, ignored);
  }
});

test("changes that land together reach subscribers as one batch", async () => {
  const feed = new ChangeFeed("/kb", { settleMs: 20 });
  try {
    const batch = nextBatch(feed);
    feed.saw("docs/b.md");
    feed.saw("docs/a.md");
    feed.saw("docs/.git/index");
    feed.saw("docs/a.md");
    assert.deepEqual((await batch).slugs, ["docs/a", "docs/b"]);
    assert.equal((await batch).cursor, feed.cursor);
  } finally {
    feed.close();
  }
});

test("the viewer's own writes stay out of the feed, other changes still reach it", async () => {
  const feed = new ChangeFeed("/kb", { settleMs: 20 });
  try {
    feed.ownWrite([path.resolve("/kb/docs/notes.md"), path.resolve("/kb/docs/moved")]);
    const batch = nextBatch(feed);
    feed.saw("docs/notes.md");
    feed.saw("docs/moved/inner.md");
    feed.saw("docs/agent.md");
    assert.deepEqual((await batch).slugs, ["docs/agent"]);

    // A batch that was only the viewer's own writes is not a batch at all.
    const before = feed.cursor;
    feed.saw("docs/notes.md");
    await wait(60);
    assert.equal(feed.cursor, before);
  } finally {
    feed.close();
  }
});

test("a page catches up on the batches after its cursor", async () => {
  const feed = new ChangeFeed("/kb", { settleMs: 5, keep: 2 });
  try {
    const rendered = feed.cursor;
    for (const name of ["one", "two", "three"]) {
      const batch = nextBatch(feed);
      feed.saw(`docs/${name}.md`);
      await batch;
    }
    // Only two are kept, so a page rendered before all three can't be told which.
    assert.deepEqual(feed.since(rendered), [{ cursor: feed.cursor, slugs: null }]);
    const afterOne = feed.since(rendered.replace(/\.0$/, ".1"));
    assert.deepEqual(afterOne.map((batch) => batch.slugs), [["docs/two"], ["docs/three"]]);
    assert.deepEqual(feed.since(feed.cursor), []);
    // A cursor from another server, or garbage, replays nothing.
    assert.deepEqual(feed.since("0123abcd.1"), []);
    assert.deepEqual(feed.since("nonsense"), []);
  } finally {
    feed.close();
  }
});

test("the feed watches the KB folder for writes made outside the viewer", async () => {
  const kb = await makeTempKb();
  await fs.mkdir(path.join(kb.dir, "docs"));
  const feed = new ChangeFeed(kb.dir, { settleMs: 50 });
  try {
    feed.start();
    await wait(200); // let the watch begin before writing
    const batch = nextBatch(feed, 5000);
    await fs.writeFile(path.join(kb.dir, "docs", "written-by-mcp.md"), "# New\n");
    assert.ok((await batch).slugs?.includes("docs/written-by-mcp"));
  } finally {
    feed.close();
    await kb.cleanup();
  }
});
