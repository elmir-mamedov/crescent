import { test } from "node:test";
import assert from "node:assert/strict";
import { assetHeaders } from "./assets.js";

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
