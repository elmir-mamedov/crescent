import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { Content } from "./content.js";
import { WIDGET_SIZE_LIMIT, registerWidgetRoutes } from "./server/widgets.js";
import { makeTempKb, trySymlink } from "./test-helpers.js";
import { WIDGET_VARIABLES, widgetDocument } from "./views/widgets.js";

/** A server with only the widget route, on a throwaway KB with one space, "Docs". */
async function withServer(
  run: (ctx: { app: ReturnType<typeof Fastify>; assets: string; dir: string }) => Promise<void>
): Promise<void> {
  const kb = await makeTempKb();
  const app = Fastify();
  try {
    const content = new Content(kb.dir);
    await content.createSpace("Docs");
    const assets = path.join(kb.dir, "docs", "_assets");
    await fs.mkdir(assets, { recursive: true });
    registerWidgetRoutes(app, { content });
    await run({ app, assets, dir: kb.dir });
  } finally {
    await app.close();
    await kb.cleanup();
  }
}

test("widgetDocument: the preamble opens the document, ahead of the widget", () => {
  const html = widgetDocument("<div id=w>hi</div><script>go()</script>");
  assert.match(html, /^<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<style>/);
  assert.ok(html.indexOf("</script>") < html.indexOf("<div id=w>"), "the preamble's script runs first");
  assert.ok(html.endsWith("<div id=w>hi</div><script>go()</script>"));
});

test("widgetDocument: a widget's own doctype is taken off, the rest of it kept", () => {
  const html = widgetDocument('\uFEFF\n<!DOCTYPE html>\n<html lang="cs"><head><title>T</title></head><body>x</body></html>');
  assert.equal(html.match(/<!doctype/gi)?.length, 1);
  assert.match(html, /<html lang="cs"><head><title>T<\/title><\/head><body>x<\/body><\/html>$/);
});

test("widgetDocument: every variable agents are told of is set, in both themes", () => {
  const html = widgetDocument("");
  const dark = /:root\{([^}]*)\}/.exec(html)![1];
  const light = /:root\[data-theme="light"\]\{([^}]*)\}/.exec(html)![1];
  for (const name of WIDGET_VARIABLES) assert.match(dark, new RegExp(`${name}:[^;]+;`), name);
  for (const name of WIDGET_VARIABLES.filter((name) => !/font|mono/.test(name))) {
    assert.match(light, new RegExp(`${name}:#[0-9a-f]{3,6};`), name);
  }
  assert.doesNotMatch(html, /undefined/);
  assert.match(light, /color-scheme:light/);
  assert.match(dark, /color-scheme:dark/);
});

test("embed route: a widget comes as a sandboxed, offline page, preamble first", async () => {
  await withServer(async ({ app, assets }) => {
    await fs.writeFile(path.join(assets, "tcp.html"), "<p>handshake</p>");
    const res = await app.inject({ url: "/_embed/docs/_assets/tcp.html" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    const csp = String(res.headers["content-security-policy"]);
    assert.match(csp, /^sandbox allow-scripts;/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["content-disposition"], undefined);
    assert.match(res.body, /^<!doctype html>/);
    assert.ok(res.body.endsWith("<p>handshake</p>"));
  });
});

test("embed route: in a folder of _assets, and named in any case", async () => {
  await withServer(async ({ app, assets }) => {
    await fs.mkdir(path.join(assets, "figures"));
    await fs.writeFile(path.join(assets, "figures", "Wave.HTML"), "<p>wave</p>");
    const res = await app.inject({ url: "/_embed/docs/_assets/figures/Wave.HTML" });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.endsWith("<p>wave</p>"));
  });
});

test("embed route: nothing but a space's HTML, and no dotfile", async () => {
  await withServer(async ({ app, assets }) => {
    await fs.writeFile(path.join(assets, "plot.svg"), "<svg/>");
    await fs.writeFile(path.join(assets, ".hidden.html"), "<p>no</p>");
    for (const url of [
      "/_embed/docs/_assets/plot.svg",
      "/_embed/docs/_assets/.hidden.html",
      "/_embed/docs/_assets/missing.html",
      "/_embed/nope/_assets/tcp.html",
      "/_embed/docs/_assets/..%2F..%2Fdocs%2Findex.html",
    ]) {
      assert.equal((await app.inject({ url })).statusCode, 404, url);
    }
  });
});

test("embed route: follows no symbolic link, to a file or a folder", async (t) => {
  await withServer(async ({ app, assets, dir }) => {
    const outside = path.join(dir, "..", `${path.basename(dir)}-outside`);
    await fs.mkdir(outside);
    try {
      await fs.writeFile(path.join(outside, "secret.html"), "<p>secret</p>");
      const fileLink = await trySymlink(path.join(outside, "secret.html"), path.join(assets, "link.html"), "file");
      const dirLink = await trySymlink(outside, path.join(assets, "linked"), "dir");
      if (!fileLink && !dirLink) return t.skip("this system makes no symbolic links");
      if (fileLink) assert.equal((await app.inject({ url: "/_embed/docs/_assets/link.html" })).statusCode, 404);
      if (dirLink) assert.equal((await app.inject({ url: "/_embed/docs/_assets/linked/secret.html" })).statusCode, 404);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("embed route: a widget too big to read whole is refused", async () => {
  await withServer(async ({ app, assets }) => {
    await fs.writeFile(path.join(assets, "huge.html"), Buffer.alloc(WIDGET_SIZE_LIMIT + 1, 0x20));
    const res = await app.inject({ url: "/_embed/docs/_assets/huge.html" });
    assert.equal(res.statusCode, 413);
    assert.equal(res.headers["content-security-policy"], undefined);
  });
});
