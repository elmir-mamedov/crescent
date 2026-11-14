import { test } from "node:test";
import assert from "node:assert/strict";
import { assetHeaders, embedHeaders, isWidgetName } from "./assets.js";

test("assetHeaders: SVG and HTML download, sandboxed, and are never sniffed", () => {
  for (const name of ["diagram.svg", "page.html", "page.htm", "page.xhtml", "data.xml", "script.js"]) {
    const headers = assetHeaders(name);
    assert.equal(headers["content-disposition"], "attachment", name);
    assert.match(headers["content-security-policy"], /^sandbox;/, name);
    assert.match(headers["content-security-policy"], /default-src 'none'/, name);
    assert.equal(headers["x-content-type-options"], "nosniff", name);
  }
});

test("assetHeaders: a file of no known kind downloads", () => {
  assert.equal(assetHeaders("notes")["content-disposition"], "attachment");
  assert.equal(assetHeaders("archive.zip")["content-disposition"], "attachment");
});

test("assetHeaders: images, media and text show in place, still sandboxed", () => {
  for (const name of ["shot.png", "PHOTO.JPG", "clip.mp4", "talk.mp3", "log.txt", "a.b.webp"]) {
    const headers = assetHeaders(name);
    assert.equal(headers["content-disposition"], undefined, name);
    assert.match(headers["content-security-policy"], /^sandbox;/, name);
    assert.equal(headers["x-content-type-options"], "nosniff", name);
  }
});

test("assetHeaders: a PDF shows in place with no policy that would block its viewer", () => {
  assert.deepEqual(assetHeaders("spec.pdf"), { "x-content-type-options": "nosniff" });
  assert.deepEqual(assetHeaders("SPEC.PDF"), { "x-content-type-options": "nosniff" });
});

test("isWidgetName: an HTML file, in any case; nothing else", () => {
  for (const name of ["tcp.html", "figures/Wave.HTML"]) assert.equal(isWidgetName(name), true, name);
  for (const name of ["page.htm", "plot.svg", "html", "tcp.html.txt"]) assert.equal(isWidgetName(name), false, name);
});

test("embedHeaders: scripts in a sandbox of their own, with no network, framed only by Crescent", () => {
  const headers = embedHeaders();
  const csp = headers["content-security-policy"].split("; ");
  assert.equal(csp[0], "sandbox allow-scripts");
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'self'"));
  assert.ok(!csp.some((directive) => /allow-same-origin|allow-top-navigation|allow-popups|allow-forms|https?:|'self'.*src/.test(directive)), csp.join("; "));
  assert.equal(headers["content-type"], "text/html; charset=utf-8");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["content-disposition"], undefined);
});

test("assetHeaders: a widget opened as an asset still downloads", () => {
  assert.equal(assetHeaders("tcp.html")["content-disposition"], "attachment");
});
