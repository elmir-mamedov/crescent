import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isThreadId, makeChatStore, threadTitle, type ChatThread } from "./chat-store.js";
import { makeTempKb } from "./test-helpers.js";

const ID_A = "0b6f3a52-6d3e-4b8e-9a51-2f6c1d9e7a10";
const ID_B = "7c1e2d43-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function thread(id: string, updatedAt: string, title = "A thread"): ChatThread {
  return {
    id,
    title,
    createdAt: "2026-10-17T09:00:00.000Z",
    updatedAt,
    engine: "claude",
    sessionId: id,
    messages: [
      { role: "user", text: "what is an incentive model?", at: updatedAt, forcePages: false, slug: "demo" },
      { role: "assistant", text: "A short answer.", at: updatedAt },
      {
        role: "report",
        at: updatedAt,
        changes: [{ kind: "created", what: "page", id: "p1", slug: "demo/incentive-model", title: "Incentive model" }],
      },
    ],
  };
}

test("a saved thread reads back whole, and survives a new store on the same KB", async () => {
  const kb = await makeTempKb();
  try {
    const saved = thread(ID_A, "2026-10-17T09:05:00.000Z");
    await makeChatStore(kb.dir).save(saved);
    assert.deepEqual(await makeChatStore(kb.dir).get(ID_A), saved);
  } finally {
    await kb.cleanup();
  }
});

test("threads live under .kb25/chat, outside every space", async () => {
  const kb = await makeTempKb();
  try {
    const store = makeChatStore(kb.dir);
    assert.equal(store.dir, path.join(kb.dir, ".kb25", "chat"));
    await store.save(thread(ID_A, "2026-10-17T09:05:00.000Z"));
    await fs.access(path.join(kb.dir, ".kb25", "chat", "threads", `${ID_A}.json`));
  } finally {
    await kb.cleanup();
  }
});

test("the list is newest first and skips files that are not threads", async () => {
  const kb = await makeTempKb();
  try {
    const store = makeChatStore(kb.dir);
    await store.save(thread(ID_A, "2026-10-17T09:05:00.000Z", "Older"));
    await store.save(thread(ID_B, "2026-10-17T10:00:00.000Z", "Newer"));
    await fs.writeFile(path.join(store.dir, "threads", "notes.json"), "{}");
    await fs.writeFile(path.join(store.dir, "threads", `${ID_A.replace("0b", "ff")}.json`), "not json");
    assert.deepEqual(await store.list(), [
      { id: ID_B, title: "Newer", updatedAt: "2026-10-17T10:00:00.000Z", engine: "claude" },
      { id: ID_A, title: "Older", updatedAt: "2026-10-17T09:05:00.000Z", engine: "claude" },
    ]);
  } finally {
    await kb.cleanup();
  }
});

test("an empty KB has no threads, and missing or malformed ids read as none", async () => {
  const kb = await makeTempKb();
  try {
    const store = makeChatStore(kb.dir);
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.get(ID_A), null);
    assert.equal(await store.get("../../demo/index"), null);
    assert.equal(await store.remove("../../demo/index"), false);
    await assert.rejects(store.save({ ...thread(ID_A, "x"), id: "../escape" }));
  } finally {
    await kb.cleanup();
  }
});

test("removing a thread deletes its file only once", async () => {
  const kb = await makeTempKb();
  try {
    const store = makeChatStore(kb.dir);
    await store.save(thread(ID_A, "2026-10-17T09:05:00.000Z"));
    assert.equal(await store.remove(ID_A), true);
    assert.equal(await store.remove(ID_A), false);
    assert.equal(await store.get(ID_A), null);
  } finally {
    await kb.cleanup();
  }
});

test("thread ids are lowercase UUIDs", () => {
  assert.equal(isThreadId(ID_A), true);
  assert.equal(isThreadId(ID_A.toUpperCase()), false);
  assert.equal(isThreadId("abc"), false);
});

test("a title is the first line of the first message, cut to fit", () => {
  assert.equal(threadTitle("  what is an incentive model?\nnot sure how it's pronounced"), "what is an incentive model?");
  assert.equal(threadTitle("   "), "New chat");
  const long = threadTitle("explain classic compute in databricks from the ground up, with every detail there is");
  assert.ok(long.length <= 60);
  assert.ok(long.endsWith("…"));
});

test("a thread saved before Codex reads as Claude's, its session under its own id once started", async () => {
  const kb = await makeTempKb();
  try {
    const store = makeChatStore(kb.dir);
    await fs.mkdir(path.join(store.dir, "threads"), { recursive: true });
    const legacy = (id: string, started: boolean) => ({
      id,
      title: "Old",
      createdAt: "2026-10-17T09:00:00.000Z",
      updatedAt: "2026-10-17T09:00:00.000Z",
      started,
      messages: [],
    });
    await fs.writeFile(path.join(store.dir, "threads", `${ID_A}.json`), JSON.stringify(legacy(ID_A, true)));
    await fs.writeFile(path.join(store.dir, "threads", `${ID_B}.json`), JSON.stringify(legacy(ID_B, false)));
    const started = await store.get(ID_A);
    assert.equal(started?.engine, "claude");
    assert.equal(started?.sessionId, ID_A);
    assert.equal("started" in (started ?? {}), false);
    const unstarted = await store.get(ID_B);
    assert.equal(unstarted?.engine, "claude");
    assert.equal(unstarted?.sessionId, undefined);
  } finally {
    await kb.cleanup();
  }
});

test("a Codex thread keeps the session id Codex chose", async () => {
  const kb = await makeTempKb();
  try {
    const store = makeChatStore(kb.dir);
    await store.save({ ...thread(ID_A, "2026-10-17T09:05:00.000Z"), engine: "codex", sessionId: "01a1498f-2501-78b3" });
    const read = await store.get(ID_A);
    assert.equal(read?.engine, "codex");
    assert.equal(read?.sessionId, "01a1498f-2501-78b3");
  } finally {
    await kb.cleanup();
  }
});
