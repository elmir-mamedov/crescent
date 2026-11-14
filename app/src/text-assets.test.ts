import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { makeTempKb, pathExists, trySymlink, type TempKb } from "./test-helpers.js";
import { TEXT_ASSET_LIMIT, readTextAsset, textAssetPath, writeTextAsset } from "./text-assets.js";

async function withSpace(
  run: (ctx: { kb: TempKb; content: Content; assets: string }) => Promise<void>
): Promise<void> {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    await content.createSpace("Docs");
    await run({ kb, content, assets: path.join(kb.dir, "docs", "_assets") });
  } finally {
    await kb.cleanup();
  }
}

const WIDGET = "<p>handshake</p>\n<script>start()</script>\n";

test("textAssetPath: a widget, drawing or table, lowercase and hyphenated, folders kept", () => {
  assert.equal(textAssetPath("TCP Handshake.HTML"), "tcp-handshake.html");
  assert.equal(textAssetPath("_assets/figures/Orbit Map.svg"), "figures/orbit-map.svg");
  assert.equal(textAssetPath("data/Ýields 2026.csv"), "data/yields-2026.csv");
  assert.equal(textAssetPath("_assets/my%20widget.html"), "my-widget.html");
});

test("textAssetPath: no other kind, and no name or folder made of nothing", () => {
  for (const name of ["plot.png", "page.htm", "notes.md", "html", "_assets/", "../x.html", "a/../b.html", "!!.html", ".html"]) {
    assert.equal(textAssetPath(name), null, name);
  }
});

test("writeTextAsset: writes a new file into _assets, making its folders", async () => {
  await withSpace(async ({ content, assets }) => {
    const written = await writeTextAsset(content, "docs", "figures/TCP.html", WIDGET);
    assert.deepEqual(written, { path: "figures/tcp.html", fsPath: path.join(assets, "figures", "tcp.html"), created: true });
    assert.equal(await fs.readFile(written.fsPath, "utf8"), WIDGET);
  });
});

test("writeTextAsset: replaces a file of that name in place, leaving nothing beside it", async () => {
  await withSpace(async ({ content, assets }) => {
    await writeTextAsset(content, "docs", "tcp.html", WIDGET);
    const again = await writeTextAsset(content, "docs", "_assets/tcp.html", "<p>v2</p>");
    assert.equal(again.created, false);
    assert.equal(await fs.readFile(again.fsPath, "utf8"), "<p>v2</p>");
    assert.deepEqual(await fs.readdir(assets), [".gitkeep", "tcp.html"]);
  });
});

test("writeTextAsset: refuses an empty file, a path for content, an SVG with no drawing, and one too big", async () => {
  await withSpace(async ({ content, assets }) => {
    await assert.rejects(writeTextAsset(content, "docs", "a.html", "  \n"), /empty/);
    await assert.rejects(writeTextAsset(content, "docs", "a.html", "/Users/me/widget.html"), /not a path/);
    await assert.rejects(writeTextAsset(content, "docs", "a.svg", "<p>no</p>"), /no <svg> element/);
    await assert.rejects(writeTextAsset(content, "docs", "a.csv", "x".repeat(TEXT_ASSET_LIMIT + 1)), /too big/);
    await assert.rejects(writeTextAsset(content, "docs", "a.png", WIDGET), /ending in \.html, \.svg or \.csv/);
    await assert.rejects(writeTextAsset(content, "nope", "a.html", WIDGET), /no space named "nope"/);
    assert.deepEqual(await fs.readdir(assets), [".gitkeep"]);
  });
});

test("writeTextAsset: an SVG and a CSV are written as they are", async () => {
  await withSpace(async ({ content }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>';
    assert.equal(await fs.readFile((await writeTextAsset(content, "docs", "dot.svg", svg)).fsPath, "utf8"), svg);
    assert.equal(await fs.readFile((await writeTextAsset(content, "docs", "t.csv", "a,b\n1,2\n")).fsPath, "utf8"), "a,b\n1,2\n");
  });
});

test("writeTextAsset: writes nothing through a link, for _assets, a folder in it or the file", async (t) => {
  await withSpace(async ({ kb, content, assets }) => {
    const outside = path.join(kb.dir, "..", `${path.basename(kb.dir)}-outside`);
    await fs.mkdir(outside);
    try {
      await fs.writeFile(path.join(outside, "victim.html"), "original");
      await fs.rm(assets, { recursive: true });
      if (!(await trySymlink(outside, assets, "dir"))) return t.skip("this system makes no symbolic links");
      await assert.rejects(writeTextAsset(content, "docs", "victim.html", WIDGET), /not a folder Crescent can write to/);
      await fs.rm(assets);

      await fs.mkdir(assets);
      await trySymlink(outside, path.join(assets, "figures"), "dir");
      await assert.rejects(writeTextAsset(content, "docs", "figures/new.html", WIDGET), /_assets\/figures is not a folder/);
      assert.equal(await pathExists(path.join(outside, "new.html")), false);

      if (await trySymlink(path.join(outside, "victim.html"), path.join(assets, "victim.html"), "file")) {
        await assert.rejects(writeTextAsset(content, "docs", "victim.html", WIDGET), /not a file Crescent can replace/);
      }
      assert.equal(await fs.readFile(path.join(outside, "victim.html"), "utf8"), "original");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("readTextAsset: reads a text asset by its link, null when there is none", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.mkdir(path.join(assets, "figures"), { recursive: true });
    await fs.writeFile(path.join(assets, "figures", "my widget.html"), WIDGET);
    const asset = await readTextAsset(content, "docs", "_assets/figures/my%20widget.html");
    assert.deepEqual(asset, { path: "figures/my widget.html", fsPath: path.join(assets, "figures", "my widget.html"), text: WIDGET });
    assert.equal((await readTextAsset(content, "docs", "figures/my widget.html"))?.text, WIDGET);
    assert.equal(await readTextAsset(content, "docs", "_assets/missing.html"), null);
    assert.equal(await readTextAsset(content, "nope", "_assets/figures/my widget.html"), null);
  });
});

test("readTextAsset: refuses an image that is not text, and a file too big", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.writeFile(path.join(assets, "plot.png"), "png");
    await fs.writeFile(path.join(assets, "huge.csv"), Buffer.alloc(TEXT_ASSET_LIMIT + 1, 0x61));
    await assert.rejects(readTextAsset(content, "docs", "_assets/plot.png"), /plot\.png is not one/);
    await assert.rejects(readTextAsset(content, "docs", "_assets/huge.csv"), /too big to read/);
  });
});
