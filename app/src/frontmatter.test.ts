import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_NAME_MAX,
  cleanLabelNames,
  labelKey,
  normalizeLabelName,
  parsePage,
} from "./frontmatter.js";

test("frontmatter: labels survive parsing as a list of names", () => {
  const page = parsePage("---\ntitle: Deploy\nlabels:\n  - Draft\n  - Needs review\n---\nBody\n");
  assert.deepEqual(page.data.labels, ["Draft", "Needs review"]);
});

test("frontmatter: a page without labels still validates", () => {
  const page = parsePage("---\ntitle: Deploy\n---\nBody\n");
  assert.equal(page.data.labels, undefined);
});

test("frontmatter: a single bare label is refused, like a bare tag", () => {
  assert.throws(() => parsePage("---\ntitle: Deploy\nlabels: Draft\n---\n"), /labels/);
});

test("labelKey: case, surrounding space and Unicode form do not split a label", () => {
  assert.equal(labelKey("  Needs Review "), "needs review");
  // "é" typed as one code point and as e + combining accent.
  assert.equal(labelKey("Café"), labelKey("Café"));
});

test("normalizeLabelName: trims and accepts an ordinary name", () => {
  assert.equal(normalizeLabelName("  Needs review "), "Needs review");
});

test("normalizeLabelName: refuses empty, overlong, comma and control-character names", () => {
  assert.throws(() => normalizeLabelName("   "), /needs a name/);
  assert.throws(() => normalizeLabelName("x".repeat(LABEL_NAME_MAX + 1)), /at most/);
  assert.equal(normalizeLabelName("x".repeat(LABEL_NAME_MAX)).length, LABEL_NAME_MAX);
  assert.throws(() => normalizeLabelName("a, b"), /comma/);
  assert.throws(() => normalizeLabelName("line\nbreak"), /control/);
  assert.throws(() => normalizeLabelName("tab\there"), /control/);
});

test("cleanLabelNames: trims, drops blanks and non-strings, keeps the first spelling", () => {
  assert.deepEqual(cleanLabelNames([" Draft ", "", "draft", 3, "Review", "  "]), [
    "Draft",
    "Review",
  ]);
});
