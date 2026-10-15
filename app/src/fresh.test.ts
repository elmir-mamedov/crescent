import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { makeFreshPages } from "./fresh.js";
import { makeTempKb } from "./test-helpers.js";

test("a marked page stays fresh until it is cleared", async () => {
  const kb = await makeTempKb();
  try {
    const fresh = makeFreshPages(kb.dir);
    await fresh.mark("0abc123def456");
    await fresh.mark("1zzz000yyy999");
    assert.deepEqual([...(await fresh.ids())].sort(), ["0abc123def456", "1zzz000yyy999"]);

    await fresh.clear("0abc123def456");
    assert.deepEqual([...(await fresh.ids())], ["1zzz000yyy999"]);
    // Clearing is what every visit does, so a page with no mark is not an error.
    await fresh.clear("0abc123def456");
  } finally {
    await kb.cleanup();
  }
});

test("a KB nothing was ever marked in has no fresh pages", async () => {
  const kb = await makeTempKb();
  try {
    assert.equal((await makeFreshPages(kb.dir).ids()).size, 0);
  } finally {
    await kb.cleanup();
  }
});

test("marks live beside the spaces, in a folder space discovery skips", async () => {
  const kb = await makeTempKb();
  try {
    await makeFreshPages(kb.dir).mark("0abc123def456");
    await fs.access(path.join(kb.dir, ".kb25", "fresh", "0abc123def456"));
    assert.deepEqual(await new Content(kb.dir).spaces("all"), []);
  } finally {
    await kb.cleanup();
  }
});

test("an id that is not a page id never reaches the filesystem", async () => {
  const kb = await makeTempKb();
  try {
    const fresh = makeFreshPages(kb.dir);
    await fresh.mark("../escape");
    await fresh.mark("");
    await fs.writeFile(path.join(kb.dir, "keep.md"), "x");
    await fresh.clear("../keep.md");
    await fs.access(path.join(kb.dir, "keep.md"));
    assert.equal((await fresh.ids()).size, 0);
  } finally {
    await kb.cleanup();
  }
});
