import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPageMath, mathProblems, normalizeMath } from "./math-normalize.js";
import { createRenderer } from "./markdown.js";

const render = (src: string) => createRenderer(() => undefined, "kb25/page").render(src);

/** The TeX KaTeX was handed, which it keeps in the MathML it emits. */
const texOf = (html: string) =>
  [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((match) => match[1]);

const displays = (html: string) => html.match(/katex-display/g)?.length ?? 0;

/** Converts `from` to `to`, and the page shows the same formulas either way. */
function converts(from: string, to: string) {
  const { body } = normalizeMath(from);
  assert.equal(body, to);
  const before = render(from);
  const after = render(to);
  assert.deepEqual(texOf(after), texOf(before));
  return { before, after };
}

test("\\(…\\) becomes $…$ and \\[…\\] becomes $$…$$, inline and as a block", () => {
  converts(String.raw`Flow \(Q_L\) and \( k_0 \) here.`, String.raw`Flow $Q_L$ and $k_0$ here.`);
  converts(String.raw`Equilibrium \[ 2\,\mathrm{NH_3} \] inline.`, String.raw`Equilibrium $$ 2\,\mathrm{NH_3} $$ inline.`);
  const { after } = converts("Intro.\n\n\\[\nQ = a \\\\\n- b\n\\]\n\nAfter.\n", "Intro.\n\n$$\nQ = a \\\\\n- b\n$$\n\nAfter.\n");
  assert.match(after, /<div class="math-block"/);
  converts("## Rate \\(r_A\\)\n", "## Rate $r_A$\n");
});

test("feedback #76: doubled backslashes are undone", () => {
  converts(
    String.raw`Convert \\(780^\\circ\\mathrm C=1053.15\\ \\mathrm K\\) first.`,
    String.raw`Convert $780^\circ\mathrm C=1053.15\ \mathrm K$ first.`
  );
  converts("\\\\[\n\\\\frac{a}{b}\n\\\\]\n", "$$\n\\frac{a}{b}\n$$\n");
});

test("a spaced $ … $ is tightened, and kept displayed when it stands alone", () => {
  converts(String.raw`The $ k_{L} $ term.`, String.raw`The $k_{L}$ term.`);
  const { after } = converts("Before.\n\n$ \\boxed{x^2} $\n\nAfter.\n", "Before.\n\n$$\\boxed{x^2}$$\n\nAfter.\n");
  assert.equal(displays(after), 1);
  // Prices stay prices.
  converts("Costs 3 $ and 5 $ apples.", "Costs 3 $ and 5 $ apples.");
});

test("feedback #20: a single-dollar formula over several lines becomes a display block", () => {
  const { before, after } = converts("Where\n\n$Q = a\n= b$\n\nholds.\n", "Where\n\n$$Q = a\n= b$$\n\nholds.\n");
  assert.equal(displays(before), 0);
  assert.equal(displays(after), 1);
  // One that runs on into prose is inline math in that prose, and stays.
  converts("$Q = a\n= b$, which holds.\n", "$Q = a\n= b$, which holds.\n");
});

test("formulas in tables, lists, quotes and links are converted where they stand", () => {
  converts("| a | b |\n|---|---|\n| \\(x\\) | \\[y^2\\] |\n", "| a | b |\n|---|---|\n| $x$ | $$y^2$$ |\n");
  converts("> Quoted\n> \\[\n> x^2\n> \\]\n", "> Quoted\n> $$\n> x^2\n> $$\n");
  converts("- \\(x\\) item\n- $ y^2 $\n", "- $x$ item\n- $y^2$\n");
  converts("See [the \\(x\\) case](/kb25/x).\n", "See [the $x$ case](/kb25/x).\n");
  // A list item's formula belongs beside its bullet, so it is not displayed.
  converts("- $Q = a\n  = b$\n", "- $Q = a\n  = b$\n");
});

test("code blocks, code spans and notes are never touched", () => {
  const page = [
    "Write `\\(x\\)` or ``\\[y\\]`` in TeX.",
    "",
    "```latex",
    "\\(x^2\\) and \\[y^2\\]",
    "```",
    "",
    "    \\(indented\\)",
    "",
    "<!-- kb25:note id=abc kind=remark text=\"\\(x\\)\" -->",
    "Para.",
  ].join("\n");
  assert.deepEqual(normalizeMath(page), { body: page, converted: {} });
});

test("a conversion that would change what the page shows is not made", () => {
  // `$x$5` is not math, as a price before a number is not.
  converts(String.raw`Then \(x\)5 and \(y\).`, String.raw`Then \(x\)5 and $y$.`);
});

test("$…$ and $$…$$ as they should be are left alone", () => {
  const page = "Inline $x^2$, display\n\n$$\n\\frac{a}{b}\n$$\n\nand $$y$$ too. Costs $5 and $10.\n";
  assert.deepEqual(normalizeMath(page), { body: page, converted: {} });
});

test("a formula KaTeX can't read is a problem, with its line", () => {
  const [problem, ...rest] = mathProblems("# Title\n\nGood $x$ and\nbad $\\frac{a}{b$ here.\n");
  assert.equal(rest.length, 0);
  assert.equal(problem.line, 3);
  assert.equal(problem.snippet, "\\frac{a}{b");
  assert.match(problem.why, /KaTeX can't read it/);
});

test("a TeX command KaTeX knows, left in the text, is a problem", () => {
  // What the page in feedback #76 showed, written so no rule takes it as math.
  const problems = mathProblems("Para.\n\nAt 780^\\circ\\mathrm C, and \\ce{H2O} too.\n");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 2);
  assert.match(problems[0].why, /\\circ, \\mathrm, \\ce are TeX outside any formula/);
});

test("backslashes that are not TeX are not problems", () => {
  const page = [
    "Open C:\\Users\\vlad\\path\\to\\file or \\\\server\\share\\to.",
    "A regex \\d+\\s and a \\n newline, \\Users alone.",
    "The `\\frac` command, and `$\\frac{a}{b$` as an example.",
    "",
    "```",
    "\\mathrm{x} \\(broken",
    "```",
  ].join("\n");
  assert.deepEqual(mathProblems(page), []);
});

test("checkPageMath converts, and says so in one line", () => {
  const check = checkPageMath(String.raw`A \(x\), a \(y\) and \[z^2\].`);
  assert.equal(check.body, String.raw`A $x$, a $y$ and $$z^2$$.`);
  assert.equal(
    check.converted,
    "Converted 3 formulas to the form crescent keeps (2 × \\(…\\) → $…$, 1 × \\[…\\] → $$…$$). Write math that way from the start."
  );
  assert.equal(check.refused, undefined);
});

test("checkPageMath refuses a body that would bring broken math, counting lines from the frontmatter", () => {
  const check = checkPageMath("Intro.\n\nbad $\\frac{a}{b$\n", { lineOffset: 4 });
  assert.match(check.refused ?? "", /^Not saved: math would not render in one place on this page\./);
  assert.match(check.refused ?? "", /\n- line 7, `\\frac\{a\}\{b`: KaTeX can't read it/);
});

test("checkPageMath lets an edit keep the broken math a page already had, and says so", () => {
  const previous = "Old $\\frac{a}{b$ formula.\n";
  const kept = checkPageMath("Old $\\frac{a}{b$ formula, edited.\n", { previous });
  assert.equal(kept.refused, undefined);
  assert.match(kept.existing ?? "", /^Saved\. The page already had math that does not render in one place/);

  // A second copy of it is new.
  const added = checkPageMath("Old $\\frac{a}{b$ formula.\n\nNew $\\frac{a}{b$ copy.\n", { previous });
  assert.match(added.refused ?? "", /in one place/);
});
