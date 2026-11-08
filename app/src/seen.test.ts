import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { makeSeenPages } from "./seen.js";
import { makeTempKb } from "./test-helpers.js";

/** A baseline that reports `ids` and counts how often it was asked. */
function baselineOf(ids: string[]) {
  const calls = { count: 0 };
  return { calls, list: async () => (calls.count++, ids) };
}

test("the first use records every existing page as seen, so only later ones are new", async () => {
  const kb = await makeTempKb();
  try {
    const base = baselineOf(["old1", "old2"]);
    const seen = makeSeenPages(kb.dir, base.list);
    const ids = await seen.ids();
    assert.ok(ids.has("old1") && ids.has("old2"));
    // A page that appeared since is simply not on the list.
    assert.equal(ids.has("new1"), false);
    // The baseline is taken once; after that the list on disk is the answer.
    await seen.ids();
    await makeSeenPages(kb.dir, base.list).ids();
    assert.equal(base.calls.count, 1);
  } finally {
    await kb.cleanup();
  }
});

test("an opened page stays seen, across restarts", async () => {
  const kb = await makeTempKb();
  try {
    await makeSeenPages(kb.dir, baselineOf(["old1"]).list).add("new1");
    const later = await makeSeenPages(kb.dir, baselineOf([]).list).ids();
    assert.deepEqual([...later].sort(), ["new1", "old1"]);
  } finally {
    await kb.cleanup();
  }
});

test("visits recorded at once, in one viewer or two, are all kept", async () => {
  const kb = await makeTempKb();
  try {
    const one = makeSeenPages(kb.dir, baselineOf(["old1"]).list);
    const two = makeSeenPages(kb.dir, baselineOf(["old1"]).list);
    await one.ids();
    await Promise.all([one.add("a"), one.add("b"), one.add("c")]);
    await two.add("d");
    await one.add("e");
    assert.deepEqual([...(await two.ids())].sort(), ["a", "b", "c", "d", "e", "old1"]);
  } finally {
    await kb.cleanup();
  }
});

test("an unreadable list starts over from the baseline rather than marking every page new", async () => {
  const kb = await makeTempKb();
  try {
    await fs.mkdir(path.join(kb.dir, ".kb25"));
    await fs.writeFile(path.join(kb.dir, ".kb25", "seen.json"), "{not json");
    const ids = await makeSeenPages(kb.dir, baselineOf(["old1"]).list).ids();
    assert.deepEqual([...ids], ["old1"]);
  } finally {
    await kb.cleanup();
  }
});

test("the list lives beside the spaces, in a folder space discovery skips", async () => {
  const kb = await makeTempKb();
  try {
    await makeSeenPages(kb.dir, baselineOf(["old1"]).list).add("new1");
    const saved = JSON.parse(await fs.readFile(path.join(kb.dir, ".kb25", "seen.json"), "utf8"));
    assert.deepEqual(saved, { ids: ["new1", "old1"] });
    assert.deepEqual(await new Content(kb.dir).spaces("all"), []);
  } finally {
    await kb.cleanup();
  }
});

test("a page marked unread is new again, until it is next opened", async () => {
  const kb = await makeTempKb();
  try {
    const seen = makeSeenPages(kb.dir, baselineOf(["old1", "old2"]).list);
    await seen.add("new1");
    await seen.remove("old1");
    await seen.remove("new1");
    // Kept across restarts, like a visit.
    const later = makeSeenPages(kb.dir, baselineOf([]).list);
    assert.deepEqual([...(await later.ids())], ["old2"]);
    await later.add("old1");
    assert.deepEqual([...(await seen.ids())].sort(), ["old1", "old2"]);
  } finally {
    await kb.cleanup();
  }
});

test("marking unread before the list began still starts it from the baseline", async () => {
  const kb = await makeTempKb();
  try {
    const seen = makeSeenPages(kb.dir, baselineOf(["old1", "old2"]).list);
    await seen.remove("old1");
    // Only the page marked is new; the rest of the KB is not lit up.
    assert.deepEqual([...(await seen.ids())], ["old2"]);
    // A page that was never seen stays as it was.
    await seen.remove("never");
    assert.deepEqual([...(await seen.ids())], ["old2"]);
  } finally {
    await kb.cleanup();
  }
});
