import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ClaudeEvent, ClaudeStatus, TurnOptions } from "./claude-cli.js";
import { makeChatStore } from "./chat-store.js";
import {
  CHAT_PROMPT,
  activityText,
  contextBlock,
  makeChat,
  pageChanges,
  resolveChanges,
  type RunEvent,
} from "./chat.js";
import type { PageNode } from "./content.js";
import { makeTempKb } from "./test-helpers.js";

const ID = "0b6f3a52-6d3e-4b8e-9a51-2f6c1d9e7a10";
const OK: ClaudeStatus = { state: "ok", path: "/bin/claude", version: "2.1.302" };

function node(slug: string, title: string, id?: string, extra: Partial<PageNode> = {}): PageNode {
  return {
    slug,
    id,
    title,
    fsPath: `/kb/${slug}.md`,
    isSection: false,
    isFolder: false,
    archived: false,
    children: [],
    ...extra,
  } as PageNode;
}

const PAGES = [
  node("demo", "Demo", "space-id"),
  node("demo/economics", "Economics", "econ-id", { isFolder: true, isSection: true }),
  node("demo/economics/incentive-model", "Incentive model", "inc-id"),
];

/** A kb25 tool call with its JSON result, the way a turn records it. */
function call(tool: string, input: Record<string, unknown>, result: Record<string, unknown> | string, isError = false) {
  return {
    name: `mcp__kb25__${tool}`,
    input,
    result: { isError, text: typeof result === "string" ? result : JSON.stringify(result) },
  };
}

test("a created page is reported once, even when it is edited after", () => {
  const changes = pageChanges([
    call("kb_create_page", { parent: "demo", title: "Incentive model" }, { created: true, slug: "demo/incentive-model", id: "inc-id" }),
    call("kb_update_page", { slug: "demo/incentive-model" }, { updated: true, slug: "demo/incentive-model" }),
  ]);
  assert.deepEqual(changes, [
    { kind: "created", what: "page", id: "inc-id", slug: "demo/incentive-model", title: "Incentive model" },
  ]);
});

test("edits, notes, archives and folder renames of existing pages are reported as such", () => {
  const changes = pageChanges([
    call("kb_update_page", { slug: "demo/a" }, { updated: true, slug: "demo/a" }),
    call("kb_add_agent_note", { slug: "demo/b" }, { added: true, slug: "demo/b" }),
    call("kb_add_agent_note", { slug: "demo/c" }, { added: false, slug: "demo/c" }),
    call("kb_archive_page", { slug: "demo/d" }, { archived: true, slug: "demo/d" }),
    call("kb_rename_folder", { slug: "demo/e", name: "Economics" }, { renamed: true, slug: "demo/e" }),
  ]);
  assert.deepEqual(
    changes.map((c) => [c.kind, c.what, c.slug]),
    [
      ["updated", "page", "demo/a"],
      ["noted", "page", "demo/b"],
      ["archived", "page", "demo/d"],
      ["renamed", "folder", "demo/e"],
    ]
  );
});

test("failed calls, refusals, reads and web tools are not changes", () => {
  const changes = pageChanges([
    call("kb_create_page", { title: "X" }, "Space instructions changed; read them again.", true),
    call("kb_get_page", { slug: "demo" }, { slug: "demo", title: "Demo" }),
    call("kb_create_page", { title: "Y" }, "not json"),
    { name: "WebSearch", input: { query: "databricks" }, result: { isError: false, text: "{}" } },
    { name: "mcp__kb25__kb_create_page", input: { title: "Z" } },
  ]);
  assert.deepEqual(changes, []);
});

test("a page created and deleted in one turn is not reported; a deleted old one is", () => {
  const changes = pageChanges([
    call("kb_create_page", { title: "Draft" }, { created: true, slug: "demo/draft", id: "d1" }),
    call("kb_delete_page", { slug: "demo/draft" }, { deleted: true, slug: "demo/draft" }),
    call("kb_delete_page", { slug: "demo/old" }, { deleted: true, slug: "demo/old" }),
  ]);
  assert.deepEqual(changes, [{ kind: "deleted", what: "page", slug: "demo/old", title: "" }]);
});

test("a move carries the page, and what was filed under it, to the new slug", () => {
  const changes = pageChanges([
    call("kb_create_folder", { title: "Compute" }, { created: true, slug: "demo/compute", id: "f1" }),
    call("kb_create_page", { title: "Classic" }, { created: true, slug: "demo/compute/classic", id: "p1" }),
    call("kb_move_page", { sourceSlug: "demo/compute", targetParent: "demo/databricks" }, {
      moved: true,
      oldSlug: "demo/compute",
      newSlug: "demo/databricks/compute",
    }),
    call("kb_rename_page", { slug: "demo/x", newName: "Y" }, { renamed: true, oldSlug: "demo/x", newSlug: "demo/y" }),
    call("kb_rename_page", { slug: "demo/z", newName: "z" }, { renamed: false, slug: "demo/z" }),
  ]);
  assert.deepEqual(
    changes.map((c) => [c.kind, c.slug]),
    [
      ["created", "demo/databricks/compute"],
      ["created", "demo/databricks/compute/classic"],
      ["renamed", "demo/y"],
    ]
  );
});

test("changes resolve to the KB as it stands: by id first, then by slug", () => {
  const resolved = resolveChanges(
    [
      // Moved since the turn: the id finds it.
      { kind: "created", what: "page", id: "inc-id", slug: "demo/incentive-model", title: "Incentive model" },
      // No id from the tool: the slug fills in title and id.
      { kind: "updated", what: "page", slug: "demo/economics", title: "" },
      { kind: "deleted", what: "page", slug: "demo/gone", title: "" },
      { kind: "updated", what: "page", slug: "demo/vanished", title: "" },
    ],
    PAGES
  );
  assert.deepEqual(resolved, [
    { kind: "created", what: "page", id: "inc-id", slug: "demo/economics/incentive-model", title: "Incentive model" },
    { kind: "updated", what: "page", id: "econ-id", slug: "demo/economics", title: "Economics" },
    { kind: "deleted", what: "page", slug: "demo/gone", title: "gone" },
    { kind: "updated", what: "page", slug: "demo/vanished", title: "vanished" },
  ]);
});

test("the context names the page, the space home, or nothing, and the toggle", () => {
  assert.equal(
    contextBlock("demo/economics/incentive-model", false, PAGES),
    '<kb25-context>\nThe person is viewing the page "Incentive model" (slug demo/economics/incentive-model, id inc-id) in space "demo".\n</kb25-context>'
  );
  assert.match(contextBlock("demo/economics", false, PAGES), /viewing the folder "Economics"/);
  assert.match(contextBlock("demo", false, PAGES), /home page of space "demo" \("Demo", id space-id\)/);
  assert.match(contextBlock("other/page", false, PAGES), /viewing other\/page, in space "other"/);
  assert.match(contextBlock(undefined, false, PAGES), /not viewing any page/);
  assert.match(contextBlock("demo", true, PAGES), /"Write to KB" is on/);
  assert.doesNotMatch(contextBlock("demo", false, PAGES), /Write to KB/);
});

test("the activity line says what the turn is doing", () => {
  assert.equal(activityText("WebSearch", { query: "databricks classic compute" }), "Searching the web for “databricks classic compute”…");
  assert.equal(activityText("WebFetch", { url: "https://docs.databricks.com/x" }), "Reading docs.databricks.com…");
  assert.equal(activityText("mcp__kb25__kb_create_page", { title: "Incentive model" }), "Writing “Incentive model”…");
  assert.equal(activityText("mcp__kb25__kb_get_page", { slug: "demo/a" }), "Reading demo/a…");
  assert.equal(activityText("mcp__kb25__kb_move_page", { sourceSlug: "demo/a" }), "Moving demo/a…");
  assert.equal(activityText("Unknown", {}), "Working…");
});

test("the system prompt keeps the hand-off and the explicit-request rule", () => {
  assert.match(CHAT_PROMPT, /do not summarise them, list them, link them/);
  assert.match(CHAT_PROMPT, /even "from the ground up", is a chat request/);
  assert.match(CHAT_PROMPT, /Write to KB/);
});

/**
 * A stand-in for startTurn. Each call takes the next script: events to emit
 * and how the process exits. A script with `hold` waits until released or
 * stopped, so a test can look at a turn mid-run.
 */
function fakeTurns(scripts: { events: ClaudeEvent[]; code?: number; stderr?: string; hold?: boolean }[]) {
  const calls: TurnOptions[] = [];
  const releases: (() => void)[] = [];
  const startTurn = (options: TurnOptions) => {
    calls.push(options);
    const script = scripts.shift() ?? { events: [] };
    let finish!: (value: { code: number | null; stderr: string }) => void;
    const done = new Promise<{ code: number | null; stderr: string }>((resolve) => (finish = resolve));
    const end = () => finish({ code: script.code ?? 0, stderr: script.stderr ?? "" });
    setImmediate(() => {
      for (const event of script.events) options.onEvent(event);
      if (script.hold) releases.push(end);
      else end();
    });
    return {
      done,
      stop: () => finish({ code: 130, stderr: "" }),
    };
  };
  return { calls, releases, startTurn };
}

const INIT: ClaudeEvent = { type: "init", sessionId: ID, model: "m", mcpServers: [] };
const result = (text = "", isError = false): ClaudeEvent => ({
  type: "result",
  isError,
  subtype: isError ? "error_during_execution" : "success",
  text,
  sessionId: ID,
});

async function withChat(
  scripts: Parameters<typeof fakeTurns>[0],
  body: (ctx: { chat: ReturnType<typeof makeChat>; fake: ReturnType<typeof fakeTurns>; kbDir: string }) => Promise<void>,
  status: ClaudeStatus = OK
) {
  const kb = await makeTempKb();
  try {
    const fake = fakeTurns(scripts);
    const chat = makeChat({
      store: makeChatStore(kb.dir),
      claude: async () => status,
      mcp: { command: "/usr/bin/node", args: ["mcp.mjs"], env: { KB_DIR: kb.dir, KB25_COMMIT_VIA: "chat" } },
      pages: async () => PAGES,
      startTurn: fake.startTurn,
      now: () => new Date("2026-10-17T10:00:00.000Z"),
    });
    await body({ chat, fake, kbDir: kb.dir });
  } finally {
    await kb.cleanup();
  }
}

/** Wait until `count` held turns have started and emitted their events. */
async function untilHeld(fake: ReturnType<typeof fakeTurns>, count = 1): Promise<void> {
  while (fake.releases.length < count) await new Promise((resolve) => setTimeout(resolve, 1));
}

/** Resolve once the thread's turn is over. */
function finished(chat: ReturnType<typeof makeChat>, id: string): Promise<RunEvent[]> {
  return new Promise((resolve) => {
    const events: RunEvent[] = [];
    const unsubscribe = chat.subscribe(id, (event) => {
      events.push(event);
      if (event.type === "done") {
        unsubscribe?.();
        resolve(events);
      }
    });
    if (!unsubscribe) resolve(events);
  });
}

test("a chat-only turn stores the question and the answer, and no report", async () => {
  await withChat(
    [
      {
        events: [
          INIT,
          { type: "text", text: "An incentive model " },
          { type: "text", text: "rewards behaviour." },
          { type: "assistant", blocks: [{ type: "text", text: "An incentive model rewards behaviour." }] },
          result("An incentive model rewards behaviour."),
        ],
      },
    ],
    async ({ chat, fake, kbDir }) => {
      const sent = await chat.send(ID, { text: "what is an incentive model?", forcePages: false, slug: "demo" });
      assert.equal(sent.ok, true);
      assert.equal(chat.running(ID), true);
      const events = await finished(chat, ID);
      assert.deepEqual(
        events.map((e) => e.type),
        ["user", "text", "text", "message", "done"]
      );

      const options = fake.calls[0];
      assert.equal(options.sessionId, ID);
      assert.equal(options.resume, false);
      assert.equal(options.cwd, path.join(kbDir, ".kb25", "chat", "cwd"));
      assert.match(options.text, /^<kb25-context>\nThe person is viewing the home page of space "demo"/);
      assert.match(options.text, /\n\nwhat is an incentive model\?$/);
      assert.equal(await fs.readFile(options.files.systemPrompt, "utf8"), CHAT_PROMPT);
      assert.match(await fs.readFile(options.files.mcpConfig, "utf8"), /"KB25_COMMIT_VIA": "chat"/);

      const thread = await chat.thread(ID);
      assert.equal(thread?.title, "what is an incentive model?");
      assert.equal(thread?.started, true);
      assert.deepEqual(
        thread?.messages.map((m) => [m.role, "text" in m ? m.text : ""]),
        [
          ["user", "what is an incentive model?"],
          ["assistant", "An incentive model rewards behaviour."],
        ]
      );
      assert.equal(chat.running(ID), false);
    }
  );
});

test("a writing turn ends with a report of the pages, and the next turn resumes the session", async () => {
  await withChat(
    [
      { events: [INIT, { type: "assistant", blocks: [{ type: "text", text: "Short answer." }] }, result("Short answer.")] },
      {
        events: [
          INIT,
          {
            type: "assistant",
            blocks: [{ type: "tool_use", id: "t1", name: "mcp__kb25__kb_create_page", input: { parent: "demo/economics", title: "Incentive model" } }],
          },
          {
            type: "tool_result",
            toolUseId: "t1",
            isError: false,
            text: JSON.stringify({ created: true, slug: "demo/economics/incentive-model", id: "inc-id" }),
          },
          result(""),
        ],
      },
    ],
    async ({ chat, fake }) => {
      await chat.send(ID, { text: "what is an incentive model?", forcePages: false });
      await finished(chat, ID);
      await chat.send(ID, { text: "okay, write it down", forcePages: false, slug: "demo" });
      const events = await finished(chat, ID);

      assert.equal(fake.calls[1].resume, true);
      assert.ok(events.some((e) => e.type === "activity" && e.text === "Writing “Incentive model”…"));
      const thread = await chat.thread(ID);
      const last = thread?.messages.at(-1);
      assert.deepEqual(last, {
        role: "report",
        at: "2026-10-17T10:00:00.000Z",
        changes: [
          { kind: "created", what: "page", id: "inc-id", slug: "demo/economics/incentive-model", title: "Incentive model" },
        ],
      });
      // No assistant text in the writing turn: the report is the whole reply.
      assert.deepEqual(
        thread?.messages.map((m) => m.role),
        ["user", "assistant", "user", "report"]
      );
    }
  );
});

test("the toggle reaches the model through the context line", async () => {
  await withChat([{ events: [INIT, result("")] }], async ({ chat, fake }) => {
    await chat.send(ID, { text: "classic compute in databricks", forcePages: true, slug: "demo" });
    await finished(chat, ID);
    assert.match(fake.calls[0].text, /"Write to KB" is on/);
    const thread = await chat.thread(ID);
    assert.deepEqual(thread?.messages[0], {
      role: "user",
      text: "classic compute in databricks",
      at: "2026-10-17T10:00:00.000Z",
      forcePages: true,
      slug: "demo",
    });
  });
});

test("a page that attaches mid-turn gets what was said so far, then the rest", async () => {
  await withChat([{ events: [INIT, { type: "text", text: "Part one. " }], hold: true }], async ({ chat, fake }) => {
    await chat.send(ID, { text: "hi", forcePages: false });
    await untilHeld(fake);
    const seen: RunEvent[] = [];
    const unsubscribe = chat.subscribe(ID, (event) => seen.push(event));
    assert.deepEqual(
      seen.map((e) => e.type),
      ["user", "text"]
    );
    const done = finished(chat, ID);
    fake.releases[0]();
    await done;
    unsubscribe?.();
    assert.equal(seen.at(-1)?.type, "done");
  });
});

test("a second message while one is answering is refused", async () => {
  await withChat([{ events: [INIT], hold: true }], async ({ chat, fake }) => {
    await chat.send(ID, { text: "first", forcePages: false });
    const second = await chat.send(ID, { text: "second", forcePages: false });
    assert.deepEqual(second.ok ? null : second.status, 409);
    assert.equal(await chat.remove(ID), false);
    await untilHeld(fake);
    const done = finished(chat, ID);
    fake.releases[0]();
    await done;
  });
});

test("nothing runs while Claude Code is missing or signed out", async () => {
  await withChat(
    [],
    async ({ chat, fake }) => {
      const sent = await chat.send(ID, { text: "hi", forcePages: false });
      assert.equal(sent.ok, false);
      if (!sent.ok) {
        assert.equal(sent.status, 503);
        assert.deepEqual(sent.claude, { state: "signed-out", path: "/bin/claude", version: "2.1.302" });
      }
      assert.equal(fake.calls.length, 0);
      assert.equal(await chat.thread(ID), null);
    },
    { state: "signed-out", path: "/bin/claude", version: "2.1.302" }
  );
});

test("bad ids and empty messages are refused before anything runs", async () => {
  await withChat([], async ({ chat, fake }) => {
    const badId = await chat.send("../x", { text: "hi", forcePages: false });
    const empty = await chat.send(ID, { text: "   ", forcePages: false });
    assert.equal(badId.ok ? 0 : badId.status, 400);
    assert.equal(empty.ok ? 0 : empty.status, 400);
    assert.equal(fake.calls.length, 0);
  });
});

test("stopping a turn keeps what it wrote and says it was stopped", async () => {
  await withChat(
    [
      {
        events: [
          INIT,
          { type: "assistant", blocks: [{ type: "tool_use", id: "t1", name: "mcp__kb25__kb_create_page", input: { title: "A" } }] },
          { type: "tool_result", toolUseId: "t1", isError: false, text: JSON.stringify({ created: true, slug: "demo/a", id: "a1" }) },
          { type: "text", text: "Now the second" },
        ],
        hold: true,
      },
    ],
    async ({ chat, fake }) => {
      let idle = 0;
      chat.onIdle(() => idle++);
      await chat.send(ID, { text: "write two pages", forcePages: false });
      await untilHeld(fake);
      assert.equal(chat.activeCount(), 1);
      const done = finished(chat, ID);
      assert.equal(chat.stop(ID), true);
      await done;
      const thread = await chat.thread(ID);
      assert.deepEqual(
        thread?.messages.map((m) => m.role),
        ["user", "report", "assistant", "error"]
      );
      // What it had streamed is kept, though the block never finished.
      assert.equal(thread?.messages[2] && "text" in thread.messages[2] ? thread.messages[2].text : "", "Now the second");
      assert.deepEqual(thread?.messages.at(-1), { role: "error", text: "Stopped.", at: "2026-10-17T10:00:00.000Z" });
      assert.equal(chat.activeCount(), 0);
      assert.equal(idle, 1);
    }
  );
});

test("a failed turn shows Claude's error, or the end of its stderr", async () => {
  await withChat(
    [
      { events: [INIT, result("Not logged in · Please run /login", true)] },
      { events: [], code: 1, stderr: "warming up\nerror: unknown option '--frobnicate'" },
    ],
    async ({ chat }) => {
      await chat.send(ID, { text: "one", forcePages: false });
      await finished(chat, ID);
      await chat.send(ID, { text: "two", forcePages: false });
      await finished(chat, ID);
      const errors = (await chat.thread(ID))?.messages.filter((m) => m.role === "error").map((m) => ("text" in m ? m.text : ""));
      assert.deepEqual(errors, ["Not logged in · Please run /login", "warming up\nerror: unknown option '--frobnicate'"]);
    }
  );
});

test("a thread whose Claude session has gone starts a new one under the same id", async () => {
  await withChat(
    [
      { events: [INIT, result("first")] },
      { events: [], code: 1, stderr: `No conversation found with session ID: ${ID}` },
      { events: [INIT, { type: "assistant", blocks: [{ type: "text", text: "fresh" }] }, result("fresh")] },
    ],
    async ({ chat, fake }) => {
      await chat.send(ID, { text: "one", forcePages: false });
      await finished(chat, ID);
      await chat.send(ID, { text: "two", forcePages: false });
      await finished(chat, ID);
      assert.deepEqual(
        fake.calls.map((c) => c.resume),
        [false, true, false]
      );
      const last = (await chat.thread(ID))?.messages.at(-1);
      assert.equal(last && "text" in last ? last.text : "", "fresh");
    }
  );
});

test("the thread list marks the one that is answering", async () => {
  await withChat([{ events: [INIT], hold: true }], async ({ chat, fake }) => {
    await chat.send(ID, { text: "hello", forcePages: false });
    await untilHeld(fake);
    assert.deepEqual(await chat.list(), [{ id: ID, title: "hello", updatedAt: "2026-10-17T10:00:00.000Z", running: true }]);
    const done = finished(chat, ID);
    fake.releases[0]();
    await done;
    assert.equal((await chat.list())[0].running, false);
  });
});
