import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_NAME_MAX,
  cleanLabelNames,
  labelKey,
  normalizeLabelName,
  parseFrontmatter,
  parsePage,
  splitFrontmatter,
  stringifyPage,
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

test("splitFrontmatter preserves the header bytes exactly", () => {
  const raw = "---\ntitle: Deploy\nid: abc\n---\n\nBody text.\n";
  const { header, body } = splitFrontmatter(raw);
  assert.equal(header, "---\ntitle: Deploy\nid: abc\n---\n");
  assert.equal(body, "\nBody text.\n");
  assert.equal(header + body, raw);
});

test("splitFrontmatter treats a file without frontmatter as all body", () => {
  const raw = "Just a body.\n";
  assert.deepEqual(splitFrontmatter(raw), { header: "", body: raw });
  // An opening delimiter that is never closed is not frontmatter either.
  assert.deepEqual(splitFrontmatter("---\ntitle: x\n"), {
    header: "",
    body: "---\ntitle: x\n",
  });
});

test("splitFrontmatter keeps a byte-order mark with the header it precedes", () => {
  const raw = "\uFEFF---\ntitle: Deploy\n---\nBody\n";
  const { header, body } = splitFrontmatter(raw);
  assert.equal(header, "\uFEFF---\ntitle: Deploy\n---\n");
  assert.equal(body, "Body\n");
  assert.equal(parsePage(raw).data.title, "Deploy");
});

test("frontmatter: a header that asks to be run as JavaScript is refused, never evaluated", () => {
  const sentinel = "__kb25FrontmatterEvaluated";
  const code = `{ title: (globalThis.${sentinel} = "ran") }`;
  for (const opener of ["---js", "---javascript", "--- js", "---JS", "\uFEFF---js", "---coffee", "---yaml"]) {
    const raw = `${opener}\n${code}\n---\nBody\n`;
    assert.throws(() => parsePage(raw), /must open with a line of just "---"/, opener);
    assert.throws(() => parseFrontmatter(raw), /must open with a line of just "---"/, opener);
  }
  assert.equal((globalThis as Record<string, unknown>)[sentinel], undefined);
});

test("frontmatter: YAML's JavaScript types are refused", () => {
  assert.throws(
    () => parsePage('---\ntitle: !!js/function "function () { return 1; }"\n---\n'),
    /Invalid frontmatter/
  );
});

test("frontmatter: a header with no closing line is an error, not a page", () => {
  assert.throws(() => parsePage("---\ntitle: Deploy\n"), /no closing "---" line/);
});

test("frontmatter: a header must be key: value fields", () => {
  assert.throws(() => parsePage("---\n- a\n- b\n---\n"), /key: value/);
  assert.throws(() => parsePage("---\njust words\n---\n"), /key: value/);
  assert.deepEqual(parseFrontmatter("---\n# only a comment\n---\nBody\n"), { data: {}, body: "Body\n" });
});

test("frontmatter: a file without a header is all body, and a thematic break is not a header", () => {
  assert.deepEqual(parseFrontmatter("# Title\n"), { data: {}, body: "# Title\n" });
  assert.deepEqual(parseFrontmatter("----\ntext\n"), { data: {}, body: "----\ntext\n" });
});

test("frontmatter: unknown keys survive parseFrontmatter for a re-write", () => {
  const { data, body } = parseFrontmatter("---\ntitle: Deploy\nowner: ops\n---\n\nBody\n");
  assert.deepEqual(data, { title: "Deploy", owner: "ops" });
  assert.equal(body, "\nBody\n");
});

test("stringifyPage writes the header pages already carry", () => {
  assert.equal(
    stringifyPage("# Deploy\n\n", { title: "Deploy", id: "abc", order: 0 }),
    "---\ntitle: Deploy\nid: abc\norder: 0\n---\n# Deploy\n\n"
  );
  assert.equal(stringifyPage("", { title: "Runbooks", type: "folder" }), "---\ntitle: Runbooks\ntype: folder\n---\n\n");
  assert.equal(stringifyPage("Body", {}), "Body\n");
});

test("stringifyPage keeps a body that itself starts like a header", () => {
  // gray-matter re-read the body here and folded such a block into the header.
  const body = "---\ntype: folder\n---\nText under two rules.\n";
  const raw = stringifyPage(body, { title: "Rules" });
  assert.equal(raw, `---\ntitle: Rules\n---\n${body}`);
  const page = parsePage(raw);
  assert.deepEqual(page.data, { title: "Rules" });
  assert.equal(page.body, body);
});
