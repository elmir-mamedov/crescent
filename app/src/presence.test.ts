import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { makePresence, type PresenceStream } from "./presence.js";

const GRACE = 30_000;

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

/** A presence whose `idle()` reports how many times it decided to quit. */
function tracker() {
  let idles = 0;
  const presence = makePresence({ graceMs: GRACE, onIdle: () => (idles += 1) });
  return { presence, idle: () => idles };
}

/** A stream that records what was written to it and whether it was ended. */
function stream(): PresenceStream & { written: string[]; ended: boolean } {
  const s = {
    written: [] as string[],
    ended: false,
    write(chunk: string) {
      s.written.push(chunk);
    },
    end() {
      s.ended = true;
    },
  };
  return s;
}

test("nothing quits before a first tab has connected", () => {
  const { idle } = tracker();
  mock.timers.tick(GRACE * 10);
  assert.equal(idle(), 0);
});

test("quits once the last tab has been gone for the grace period", () => {
  const { presence, idle } = tracker();
  const release = presence.connect(stream());
  release();
  mock.timers.tick(GRACE - 1);
  assert.equal(idle(), 0);
  mock.timers.tick(1);
  assert.equal(idle(), 1);
});

test("a tab that reconnects within the grace period keeps it running", () => {
  const { presence, idle } = tracker();
  presence.connect(stream())();
  mock.timers.tick(GRACE / 2);
  const release = presence.connect(stream());
  mock.timers.tick(GRACE * 2);
  assert.equal(idle(), 0);
  // Its own departure starts a fresh grace period, not the leftover half.
  release();
  mock.timers.tick(GRACE - 1);
  assert.equal(idle(), 0);
  mock.timers.tick(1);
  assert.equal(idle(), 1);
});

test("waits for every browser's stream to go", () => {
  const { presence, idle } = tracker();
  const releaseA = presence.connect(stream());
  const releaseB = presence.connect(stream());
  releaseA();
  mock.timers.tick(GRACE * 2);
  assert.equal(idle(), 0);
  releaseB();
  mock.timers.tick(GRACE);
  assert.equal(idle(), 1);
});

test("releasing a stream twice counts once", () => {
  const { presence, idle } = tracker();
  const releaseA = presence.connect(stream());
  presence.connect(stream());
  releaseA();
  releaseA();
  assert.equal(presence.size(), 1);
  mock.timers.tick(GRACE);
  assert.equal(idle(), 0);
});

test("ending the streams to quit tells every tab, without a second quit", () => {
  const { presence, idle } = tracker();
  const a = stream();
  const b = stream();
  const releaseA = presence.connect(a);
  presence.connect(b);
  presence.endAll(true);
  for (const s of [a, b]) {
    assert.deepEqual(s.written, ["event: quit\ndata: \n\n"]);
    assert.equal(s.ended, true);
  }
  assert.equal(presence.size(), 0);
  // The connection closing afterwards releases it; that must not quit again.
  releaseA();
  mock.timers.tick(GRACE);
  assert.equal(idle(), 0);
});

test("ending the streams for a restart says nothing to the tabs", () => {
  const { presence } = tracker();
  const a = stream();
  presence.connect(a);
  presence.endAll(false);
  assert.deepEqual(a.written, []);
  assert.equal(a.ended, true);
});
