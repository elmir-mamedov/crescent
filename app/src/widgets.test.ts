import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { Content } from "./content.js";
import { WIDGET_SIZE_LIMIT, registerWidgetRoutes } from "./server/widgets.js";
import { makeTempKb, trySymlink } from "./test-helpers.js";
import { WIDGETS_SCRIPT, WIDGET_VARIABLES, widgetDocument } from "./views/widgets.js";

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

/** The preamble's own script, out of a widget's document. */
function preambleScript(): string {
  return /<script>([\s\S]*?)<\/script>/.exec(widgetDocument(""))![1];
}

test("widgetDocument: the preamble's script parses", () => {
  assert.doesNotThrow(() => new Function(preambleScript()));
});

type Message = { data: unknown; source: unknown };

/**
 * Runs WIDGETS_SCRIPT on a page holding `count` widget frames, each with a
 * window that records what the page posts it.
 */
function pageRig(count: number) {
  const root = { dataset: { theme: "dark" } as Record<string, string> };
  const frames = Array.from({ length: count }, () => {
    const posted: unknown[] = [];
    return { style: {} as Record<string, string>, loading: "lazy", contentWindow: { postMessage: (data: unknown) => posted.push(data) }, posted };
  });
  let onMessage: (event: Message) => void = () => {};
  let onTheme: () => void = () => {};
  const win: Record<string, unknown> = {};
  new Function("window", "document", "addEventListener", "MutationObserver", "setTimeout", WIDGETS_SCRIPT)(
    win,
    { documentElement: root, querySelectorAll: (selector: string) => (selector === "iframe.widget-frame" ? frames : []) },
    (type: string, fn: (event: Message) => void) => {
      if (type === "message") onMessage = fn;
    },
    class {
      constructor(fn: () => void) {
        onTheme = fn;
      }
      observe() {}
    },
    // The pause after the last answer passes at once; the give-up time never does.
    (fn: () => void, ms: number) => {
      if (ms < 1000) fn();
    }
  );
  const from = (frame: (typeof frames)[number], data: unknown) => onMessage({ data, source: frame.contentWindow });
  const switchTheme = (theme: string) => {
    root.dataset.theme = theme;
    onTheme();
  };
  return { frames, from, switchTheme, onMessage: (event: Message) => onMessage(event), print: win.__widgetsForPrint as (on: boolean) => Promise<void> };
}

test("WIDGETS_SCRIPT: a frame that starts is told the theme, and again when it changes", () => {
  const rig = pageRig(2);
  rig.from(rig.frames[0], { kb25: "ready" });
  assert.deepEqual(rig.frames[0].posted, [{ kb25: "theme", theme: "dark" }]);
  assert.deepEqual(rig.frames[1].posted, []);
  rig.switchTheme("light");
  assert.deepEqual(rig.frames[0].posted.at(-1), { kb25: "theme", theme: "light" });
  assert.deepEqual(rig.frames[1].posted, [{ kb25: "theme", theme: "light" }]);
});

test("WIDGETS_SCRIPT: a frame is as tall as it says, within bounds", () => {
  const rig = pageRig(1);
  const [frame] = rig.frames;
  rig.from(frame, { kb25: "height", height: 412.4 });
  assert.equal(frame.style.height, "413px");
  rig.from(frame, { kb25: "height", height: 0 });
  rig.from(frame, { kb25: "height", height: "900" });
  assert.equal(frame.style.height, "413px");
  rig.from(frame, { kb25: "height", height: 1e9 });
  assert.equal(frame.style.height, "5000px");
});

test("WIDGETS_SCRIPT: a message from anything but one of the page's frames is ignored", () => {
  const rig = pageRig(1);
  rig.onMessage({ data: { kb25: "height", height: 700 }, source: {} });
  rig.onMessage({ data: { kb25: "ready" }, source: null });
  assert.equal(rig.frames[0].style.height, undefined);
  assert.deepEqual(rig.frames[0].posted, []);
});

test("WIDGETS_SCRIPT: a print loads every frame in the light theme, and waits for them to wear it", async () => {
  const rig = pageRig(2);
  let printed = false;
  const ready = rig.print(true).then(() => (printed = true));
  for (const frame of rig.frames) {
    assert.equal(frame.loading, "eager");
    assert.deepEqual(frame.posted.at(-1), { kb25: "theme", theme: "light" });
  }
  rig.from(rig.frames[0], { kb25: "themed", theme: "light" });
  rig.from(rig.frames[1], { kb25: "themed", theme: "dark" }); // an answer to an older message
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(printed, false);
  rig.from(rig.frames[1], { kb25: "themed", theme: "light" });
  await ready;
  assert.equal(printed, true);
  await rig.print(false);
  for (const frame of rig.frames) assert.deepEqual(frame.posted.at(-1), { kb25: "theme", theme: "dark" });
});
