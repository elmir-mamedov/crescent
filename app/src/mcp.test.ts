import { test } from "node:test";
import assert from "node:assert/strict";
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
