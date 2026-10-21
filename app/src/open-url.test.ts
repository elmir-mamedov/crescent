import { test } from "node:test";
import assert from "node:assert/strict";
import { browserCommand, webAddress } from "./open-url.js";

test("web addresses pass, normalized", () => {
  assert.equal(webAddress("https://example.com/a b?q=\"x\""), "https://example.com/a%20b?q=%22x%22");
  assert.equal(webAddress("http://localhost:25250/kb25/page"), "http://localhost:25250/kb25/page");
});

test("anything else is refused", () => {
  for (const raw of [null, "", "not a url", "file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c", "smb://host/share"]) {
    assert.equal(webAddress(raw), null, String(raw));
  }
});

test("the default browser opens without a shell in between", () => {
  const href = "https://example.com/?a=1&calc";
  assert.deepEqual(browserCommand(href, "darwin"), ["open", [href]]);
  assert.deepEqual(browserCommand(href, "win32"), ["rundll32.exe", ["url.dll,FileProtocolHandler", href]]);
  assert.deepEqual(browserCommand(href, "linux"), ["xdg-open", [href]]);
});
