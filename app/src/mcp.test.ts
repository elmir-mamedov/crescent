import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeTempKb } from "./test-helpers.js";

test("feedback #62: the MCP server introduces itself as crescent, with its icon", async () => {
  const kb = await makeTempKb();
  const client = new Client({ name: "mcp.test", version: "0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", path.join(import.meta.dirname, "mcp.ts")],
        cwd: path.join(import.meta.dirname, ".."),
        // Its own KB, and no per-user settings file to read another from.
        env: { KB_DIR: kb.dir, XDG_CONFIG_HOME: kb.dir },
        stderr: "ignore",
      })
    );
    const info = client.getServerVersion();
    assert.equal(info?.name, "crescent");
    assert.equal(info?.title, "crescent");
    assert.deepEqual(
      info?.icons?.map((icon) => icon.sizes),
      [["64x64"], ["192x192"]]
    );
    for (const icon of info?.icons ?? []) {
      assert.equal(icon.mimeType, "image/png");
      // A PNG's signature, base64-encoded.
      assert.match(icon.src, /^data:image\/png;base64,iVBORw0KGgo/);
    }
    // What tells the person's Claude that "crescent" means these tools.
    assert.match(client.getInstructions() ?? "", /^crescent is the person's knowledge base app/);
  } finally {
    await client.close();
    await kb.cleanup();
  }
});

test("the instructions and every tool's description fit in what Claude Code passes on", async () => {
  // Claude Code 2.1.325 cuts a local server's instructions, and each tool's
  // description, at 4,096 characters, without a word to the agent: a rule past
  // that never reached it. See the note on the server in mcp.ts.
  const LIMIT = 4096;
  const kb = await makeTempKb();
  const client = new Client({ name: "mcp.test", version: "0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", path.join(import.meta.dirname, "mcp.ts")],
        cwd: path.join(import.meta.dirname, ".."),
        env: { KB_DIR: kb.dir, XDG_CONFIG_HOME: kb.dir },
        stderr: "ignore",
      })
    );
    const instructions = client.getInstructions() ?? "";
    assert.ok(instructions.length <= LIMIT, `the instructions are ${instructions.length} characters, over ${LIMIT}`);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);
    for (const tool of tools) {
      const length = tool.description?.length ?? 0;
      assert.ok(length <= LIMIT, `${tool.name}'s description is ${length} characters, over ${LIMIT}`);
    }
  } finally {
    await client.close();
    await kb.cleanup();
  }
});

/** The token a read_me result hands out. */
function readMeToken(result: { text: string }): string {
  const token = /Your token is `([^`]+)`/.exec(result.text)?.[1];
  assert.ok(token, result.text.slice(0, 200));
  return token;
}

test("feedback #34: read_me comes before every other tool, which refuses without its token", async () => {
  const kb = await makeTempKb();
  const client = new Client({ name: "mcp.test", version: "0" });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return { isError: !!result.isError, text: result.content[0]?.text ?? "" };
  };
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", path.join(import.meta.dirname, "mcp.ts")],
        cwd: path.join(import.meta.dirname, ".."),
        env: { KB_DIR: kb.dir, XDG_CONFIG_HOME: kb.dir },
        stderr: "ignore",
      })
    );
    // What an agent sees before its first call sends it to read_me.
    assert.match(client.getInstructions() ?? "", /Before you use any other crescent tool, call read_me/);
    const { tools } = await client.listTools();
    const readMe = tools.find((tool) => tool.name === "read_me");
    assert.match(readMe?.description ?? "", /^Call this first, before any other crescent tool/);
    assert.ok(!readMe?.inputSchema.required?.includes("i_have_seen_read_me"));
    for (const tool of tools.filter((tool) => tool.name !== "read_me")) {
      assert.ok(tool.inputSchema.required?.includes("i_have_seen_read_me"), `${tool.name} does not require the token`);
    }

    // Without the token, or with a made-up one, a tool does nothing but say to read the guide.
    const none = await call("kb_list_spaces", {});
    assert.equal(none.isError, true);
    assert.match(none.text, /Call read_me first/);
    const guessed = await call("kb_list_spaces", { i_have_seen_read_me: "guess" });
    assert.equal(guessed.isError, true);
    assert.match(guessed.text, /Call read_me again/);

    // The first read gives the core and the token, which then opens every tool.
    const first = await call("read_me", {});
    assert.equal(first.isError, false);
    assert.match(first.text, /^# crescent: how to work here/);
    assert.match(first.text, /## Space instructions/);
    const token = readMeToken(first);
    assert.equal((await call("kb_list_spaces", { i_have_seen_read_me: token })).isError, false);

    // A module, asked for with the token, comes without the core again.
    const modules = await call("read_me", { modules: ["math", "figures"], i_have_seen_read_me: token });
    assert.doesNotMatch(modules.text, /## Space instructions/);
    assert.match(modules.text, /# Module: math[\s\S]*# Module: figures/);
    assert.equal(readMeToken(modules), token);
  } finally {
    await client.close();
    await kb.cleanup();
  }
});

test("a chat thread keeps its read_me token across turns, until the guide changes", async () => {
  const { threadReadMeToken } = await import("./read-me.js");
  assert.equal(threadReadMeToken("thread-a"), threadReadMeToken("thread-a"));
  assert.notEqual(threadReadMeToken("thread-a"), threadReadMeToken("thread-b"));
});

test("feedback #76: a page write puts its math into $…$ and refuses math that won't render", async () => {
  const kb = await makeTempKb();
  const client = new Client({ name: "mcp.test", version: "0" });
  let token = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: { ...args, i_have_seen_read_me: token } })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return { isError: !!result.isError, text: result.content[0]?.text ?? "" };
  };
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", path.join(import.meta.dirname, "mcp.ts")],
        cwd: path.join(import.meta.dirname, ".."),
        // git, and an identity to commit with, and nothing else of this machine's.
        env: {
          KB_DIR: kb.dir,
          XDG_CONFIG_HOME: kb.dir,
          HOME: kb.dir,
          PATH: process.env.PATH ?? "",
          GIT_AUTHOR_NAME: "KB25 Test",
          GIT_AUTHOR_EMAIL: "test@kb25.local",
          GIT_COMMITTER_NAME: "KB25 Test",
          GIT_COMMITTER_EMAIL: "test@kb25.local",
          ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }),
        },
        stderr: "ignore",
      })
    );
    token = readMeToken(await call("read_me", {}));
    assert.equal((await call("kb_create_space", { title: "Math" })).isError, false);

    const created = await call("kb_create_page", {
      parent: "math",
      title: "Heat",
      body: String.raw`At \\(780^\\circ\\mathrm C\\), and \(T\) in kelvin.` + "\n",
    });
    assert.equal(created.isError, false, created.text);
    assert.match(JSON.parse(created.text).mathConverted, /^Converted 2 formulas/);
    const file = path.join(kb.dir, "math", "heat.md");
    assert.match(await fs.readFile(file, "utf8"), /At \$780\^\\circ\\mathrm C\$, and \$T\$ in kelvin\./);

    const refused = await call("kb_create_page", { parent: "math", title: "Broken", body: "Bad $\\frac{a}{b$.\n" });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /^Not saved: math would not render in one place on this page\./);
    assert.match(refused.text, /- line 1, `\\frac\{a\}\{b`/);
    await assert.rejects(fs.access(path.join(kb.dir, "math", "broken.md")));

    // An update converts too, counting lines from the top of what it was sent.
    const raw = await fs.readFile(file, "utf8");
    const updated = await call("kb_update_page", {
      slug: "math/heat",
      markdown: raw + "\nAnd \\[ Q = mc\\,\\Delta T \\] too.\n",
    });
    assert.equal(updated.isError, false, updated.text);
    assert.match(JSON.parse(updated.text).mathConverted, /1 × \\\[…\\\] → \$\$…\$\$/);
    assert.match(await fs.readFile(file, "utf8"), /And \$\$ Q = mc\\,\\Delta T \$\$ too\./);

    const lines = (raw + "\n").split("\n").length;
    const broken = await call("kb_update_page", { slug: "math/heat", markdown: raw + "\nThen $\\frac{1}{2$.\n" });
    assert.equal(broken.isError, true);
    assert.match(broken.text, new RegExp(`- line ${lines}, `));
  } finally {
    await client.close();
    await kb.cleanup();
  }
});
