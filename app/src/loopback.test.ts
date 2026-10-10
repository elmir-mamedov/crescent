import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopbackHost } from "./loopback.js";

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
