import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath } from "./server/http.js";

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
