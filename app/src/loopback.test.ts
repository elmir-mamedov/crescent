import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSiteRefusal, isLoopbackHost } from "./loopback.js";

test("loopback names and addresses count as loopback", () => {
  for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
});

test("wildcard and network binds do not", () => {
  for (const host of ["0.0.0.0", "::", "192.168.1.10", "kb.example.com", "", "127.0.0.1.example.com"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test("the viewer's own pages and forms pass on any loopback name", () => {
  for (const host of ["localhost:4000", "127.0.0.1:4000", "[::1]:4000"]) {
    assert.equal(crossSiteRefusal({ method: "GET", host }), null, host);
    assert.equal(
      crossSiteRefusal({ method: "POST", host, origin: `http://${host}`, secFetchSite: "same-origin" }),
      null,
      host
    );
  }
});

test("clients that send no Origin or Sec-Fetch-Site pass", () => {
  assert.equal(crossSiteRefusal({ method: "POST", host: "localhost:4000" }), null);
  assert.equal(crossSiteRefusal({ method: "POST", host: "localhost:4000", secFetchSite: "none" }), null);
});

test("a name that is not loopback is refused, reads included", () => {
  for (const host of ["evil.example:4000", "localhost.evil.example:4000", "localhost:4000@evil.example", "", undefined]) {
    assert.ok(crossSiteRefusal({ method: "GET", host }), String(host));
  }
});

test("a write from another origin is refused", () => {
  for (const origin of ["http://evil.example", "http://localhost:4001", "null"]) {
    assert.ok(crossSiteRefusal({ method: "POST", host: "localhost:4000", origin }), origin);
  }
  assert.ok(crossSiteRefusal({ method: "post", host: "localhost:4000", secFetchSite: "cross-site" }));
  assert.ok(crossSiteRefusal({ method: "DELETE", host: "localhost:4000", secFetchSite: "same-site" }));
});

test("reads carry no Origin check, so links from elsewhere still open pages", () => {
  assert.equal(
    crossSiteRefusal({ method: "GET", host: "localhost:4000", origin: "http://evil.example", secFetchSite: "cross-site" }),
    null
  );
});
