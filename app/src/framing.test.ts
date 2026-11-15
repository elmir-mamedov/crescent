import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { Content } from "./content.js";
import { FRAME_POLICY, registerFramingHeaders } from "./server/framing.js";
import { registerStaticRoutes } from "./server/static.js";
import { registerWidgetRoutes } from "./server/widgets.js";
import { makeTempKb } from "./test-helpers.js";

/** The framing hook ahead of the real asset and widget routes, a page, and a scoped plugin's route. */
async function withServer(run: (app: ReturnType<typeof Fastify>) => Promise<void>): Promise<void> {
  const kb = await makeTempKb();
  const app = Fastify();
  try {
    const content = new Content(kb.dir);
    await content.createSpace("Docs");
    const assets = path.join(kb.dir, "docs", "_assets");
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(assets, "x.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await fs.writeFile(path.join(assets, "w.html"), "<p>widget</p>");
    registerFramingHeaders(app);
    await registerStaticRoutes(app, { kbDir: kb.dir, content, appDir: path.join(import.meta.dirname, "..") });
    registerWidgetRoutes(app, { content });
    app.get("/docs/page", async (_req, reply) => reply.type("text/html").send("<p>page</p>"));
    // The gallery's, feedback's and the chat's uploads are scoped plugins like this one.
    await app.register(async (scope) => {
      scope.post("/_scoped", async () => ({ ok: true }));
    });
    await run(app);
  } finally {
    await app.close();
    await kb.cleanup();
  }
}

test("framing: a page, a 404 and a scoped route can't be framed by any site", async () => {
  await withServer(async (app) => {
    for (const [method, url] of [["GET", "/docs/page"], ["GET", "/nowhere"], ["POST", "/_scoped"]] as const) {
      const res = await app.inject({ method, url });
      assert.equal(res.headers["x-frame-options"], "DENY", url);
      assert.equal(res.headers["content-security-policy"], FRAME_POLICY, url);
    }
  });
});

test("framing: an asset keeps its sandbox policy and is refused a frame too", async () => {
  await withServer(async (app) => {
    const res = await app.inject({ url: "/docs/_assets/x.svg" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.match(String(res.headers["content-security-policy"]), /^sandbox; default-src 'none'/);
    assert.equal(res.headers["content-disposition"], "attachment");
  });
});

test("framing: a widget may still be framed by Crescent's own pages", async () => {
  await withServer(async (app) => {
    const res = await app.inject({ url: "/_embed/docs/_assets/w.html" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-frame-options"], undefined);
    assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'self'/);
  });
});
