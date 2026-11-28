import { test } from "node:test";
import assert from "node:assert/strict";
import { attachment, safeRedirectPath } from "./server/http.js";

test("safeRedirectPath: a path on this server is kept as it is", () => {
  for (const value of ["/", "/docs/intro", "/docs/intro?rev=2#setup", "/_search?q=a%20b", "/caf%C3%A9", "/docs/a//b"]) {
    assert.equal(safeRedirectPath(value), value, value);
  }
});

test("safeRedirectPath: anything a browser would take to another site goes home instead", () => {
  for (const value of [
    "//example.org",
    "/\\example.org",
    "/\t/example.org", // the review's /%09/example.org, as the query arrives decoded
    "/\n/example.org",
    "/\r\n/example.org",
    "/ /example.org",
    "/\u0000/example.org",
    "/ /example.org",
    "https://example.org/",
    "javascript:alert(1)",
    "example.org",
    "",
  ]) {
    assert.equal(safeRedirectPath(value), "/", JSON.stringify(value));
  }
  assert.equal(safeRedirectPath(null), "/");
});

test("safeRedirectPath: never back to the sign-in form itself", () => {
  for (const value of ["/_login", "/_login?next=/docs", "/_login#x"]) assert.equal(safeRedirectPath(value), "/", value);
});

test("attachment: a name a header can't carry goes in filename* as UTF-8, with an ASCII stand-in", () => {
  assert.equal(attachment("phys-website.zip"), 'attachment; filename="phys-website.zip"');
  assert.equal(
    attachment("částice-website.zip"),
    "attachment; filename=\"castice-website.zip\"; filename*=UTF-8''%C4%8D%C3%A1stice-website.zip"
  );
  assert.equal(attachment('a "b" ж.md'), "attachment; filename=\"a _b_ _.md\"; filename*=UTF-8''a%20%22b%22%20%D0%B6.md");
});
