import katex from "katex";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  bracketCloser,
  createRenderer,
  isDisplayMath,
  readsAsTex,
  singleDollar,
  unescapeMarkdown,
} from "./markdown.js";

/**
 * The math on a page an agent writes through the MCP server, put into the one
 * form crescent keeps on disk before it is saved: `$…$` inline and `$$…$$` for
 * display, with single backslashes. GitHub, Obsidian, VS Code and Pandoc read
 * that form too, so a page stays readable outside crescent (feedback #76).
 *
 * Every math report until then had been a new way for an agent to write math,
 * and each was met by teaching the renderer one more dialect, a guess made
 * without the author. A write is the one moment the author is still there and
 * can be told. So the forms the renderer reads but nothing else does are
 * converted here, where that is unambiguous, and a formula that still would
 * not render refuses the write, saying where, so the agent fixes it in the
 * same turn. The renderer keeps reading every form it reads today, since pages
 * also arrive from the web editor, a space's remote and other editors, but it
 * learns no new ones: a new habit is met here.
 *
 * The renderer is the judge throughout, so there is no second grammar of math
 * to keep in step with markdown.ts. A conversion is kept only when the page
 * parses to the same text and the same formulas after it, and a problem is
 * what the parser leaves: a formula KaTeX cannot read, or a TeX command KaTeX
 * knows left in the text.
 */

/** The forms a conversion starts from. */
type Form = "paren" | "bracket" | "doubledParen" | "doubledBracket" | "spaced" | "multiline";

const FORM_LABEL: Record<Form, string> = {
  paren: "\\(…\\)",
  bracket: "\\[…\\]",
  doubledParen: "\\\\(…\\\\)",
  doubledBracket: "\\\\[…\\\\]",
  spaced: "$ … $",
  multiline: "a $…$ over several lines",
};

/** A formula in a form to convert: where it is, and what may replace it, likeliest first. */
interface Candidate {
  start: number;
  end: number;
  form: Form;
  variants: string[];
}

interface Pick {
  candidate: Candidate;
  variant: number;
}

let parser: MarkdownIt | undefined;

/**
 * The page's tokens, as the renderer reads them. One parser serves every call,
 * for the reason `locateQuote` keeps one: a fresh one drags highlight.js with
 * it, and parsing is stateless.
 */
function parse(body: string): Token[] {
  parser ??= createRenderer(() => undefined);
  return parser.parse(body, {});
}

/** Spaces and tabs off both ends, but never a newline, so a page keeps its line numbers. */
function trimSpaces(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, "");
}

/**
 * The formulas in forms to convert, in source order. The source is scanned as
 * the inline rules read it, a paragraph at a time, skipping code blocks, notes
 * and code spans, so a formula found here is one the renderer took. Where the
 * scan reads the page differently, the check in `normalizeMath` drops the
 * conversion.
 */
function candidates(body: string, tokens: Token[]): Candidate[] {
  const lines = body.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const skipped = new Set<number>();
  for (const token of tokens) {
    if (!token.map || !["fence", "code_block", "kb25_note"].includes(token.type)) continue;
    for (let line = token.map[0]; line < token.map[1]; line += 1) skipped.add(line);
  }

  const found: Candidate[] = [];
  for (let line = 0; line < lines.length; ) {
    if (skipped.has(line) || !lines[line].trim()) {
      line += 1;
      continue;
    }
    let last = line;
    while (last + 1 < lines.length && !skipped.has(last + 1) && lines[last + 1].trim()) last += 1;
    scanRun(body, starts[line], starts[last] + lines[last].length, found);
    line = last + 1;
  }
  return found;
}

/** The candidates in `src` from `from` to `to`, a run of lines with no blank one. */
function scanRun(src: string, from: number, to: number, found: Candidate[]): void {
  let pos = from;
  while (pos < to) {
    const char = src[pos];
    if (char === "`") {
      // A code span, taken whole, or a run of backticks with no closer.
      let width = 1;
      while (src[pos + width] === "`") width += 1;
      const close = closingBackticks(src, pos + width, to, width);
      pos = close < 0 ? pos + width : close + width;
    } else if (char === "\\") {
      const taken = bracketCandidate(src, pos, to);
      if (taken) found.push(taken);
      pos = taken ? taken.end : pos + 2;
    } else if (char === "$") {
      pos = dollarCandidate(src, pos, to, found);
    } else {
      pos += 1;
    }
  }
}

/** Where the run of exactly `width` backticks closing a code span starts, or -1. */
function closingBackticks(src: string, from: number, to: number, width: number): number {
  for (let pos = from; pos < to; ) {
    if (src[pos] !== "`") {
      pos += 1;
      continue;
    }
    let run = 1;
    while (src[pos + run] === "`") run += 1;
    if (run === width) return pos;
    pos += run;
  }
  return -1;
}

/** A `\(`, `\[`, `\\(` or `\\[` formula opening at `pos`, by the rule of `mathBracketInline`. */
function bracketCandidate(src: string, pos: number, to: number): Candidate | undefined {
  const doubled = src[pos + 1] === "\\";
  const open = doubled ? 3 : 2;
  const opener = src[pos + open - 1];
  const display = opener === "[";
  if (!display && opener !== "(") return undefined;
  const end = bracketCloser(src, pos + open, to, display ? 0x5d : 0x29, doubled);
  if (end < 0) return undefined;
  const inner = src.slice(pos + open, end);
  const tex = doubled ? unescapeMarkdown(inner) : inner;
  if (!tex.trim() || ((display || doubled) && !readsAsTex(tex.trim()))) return undefined;
  return {
    start: pos,
    end: end + open,
    form: doubled ? (display ? "doubledBracket" : "doubledParen") : display ? "bracket" : "paren",
    variants: [display ? `$$${tex}$$` : `$${trimSpaces(tex)}$`],
  };
}

/**
 * Past the `$` formula at `pos`, by the rules of `mathInline`, adding it to
 * `found` when it is spaced inside its dollars or runs over several lines.
 */
function dollarCandidate(src: string, pos: number, to: number, found: Candidate[]): number {
  if (src[pos + 1] === "$") {
    const close = src.indexOf("$$", pos + 2);
    return close >= 0 && close < to && src.slice(pos + 2, close).trim() ? close + 2 : pos + 1;
  }
  const formula = singleDollar(src, pos, to);
  if (!formula) return pos + 1;
  const end = formula.end + 1;
  const inner = src.slice(pos + 1, formula.end);
  const multiline = inner.includes("\n");
  if (!formula.spaced && !multiline) return end;

  // A formula standing on lines of its own is displayed, which a spaced one
  // already is and one over several lines was meant to be (feedback #20).
  const display = `$$${trimSpaces(inner)}$$`;
  const inline = `$${trimSpaces(inner)}$`;
  const variants = !formula.spaced ? [display] : standsAlone(src, pos, end) ? [display, inline] : [inline, display];
  found.push({ start: pos, end, form: multiline ? "multiline" : "spaced", variants });
  return end;
}

/** Whether nothing but a blockquote's `>` shares the lines from `start` to `end`. */
function standsAlone(src: string, start: number, end: number): boolean {
  const lineStart = src.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = src.indexOf("\n", end);
  return /^[\s>]*$/.test(src.slice(lineStart, start)) && !src.slice(end, lineEnd < 0 ? src.length : lineEnd).trim();
}

/** `body` with each pick's span replaced by its variant. */
function apply(body: string, picks: Pick[]): string {
  let out = "";
  let at = 0;
  for (const { candidate, variant } of [...picks].sort((a, b) => a.candidate.start - b.candidate.start)) {
    out += body.slice(at, candidate.start) + candidate.variants[variant];
    at = candidate.end;
  }
  return out + body.slice(at);
}

/**
 * What a page renders, as text and formulas, whatever delimiters it used:
 * the token stream with each formula reduced to whether it is displayed and
 * its TeX, and the anchors that differ with the source left out. A paragraph
 * that is a single-dollar formula over several lines and nothing else, outside
 * a list, counts as displayed: that is the one conversion meant to change
 * what a page shows, into what its author meant.
 */
function rendering(tokens: Token[]): string[] {
  const out: string[] = [];
  let lists = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "list_item_open") lists += 1;
    if (token.type === "list_item_close") lists -= 1;
    const loose = !lists && looseFormula(tokens, i);
    if (loose) {
      out.push(`math true ${loose.content}`);
      i += 2;
    } else if (token.type === "inline") {
      for (const child of token.children ?? []) out.push(describe(child));
    } else {
      out.push(describe(token));
    }
  }
  return out;
}

/** The single-dollar formula over several lines that is all of the paragraph opening at `i`. */
function looseFormula(tokens: Token[], i: number): Token | undefined {
  if (tokens[i].type !== "paragraph_open" || tokens[i + 2]?.type !== "paragraph_close") return undefined;
  const children = tokens[i + 1].children ?? [];
  const [only] = children;
  if (children.length !== 1 || only.type !== "math_inline" || only.markup !== "$") return undefined;
  return only.content.includes("\n") ? only : undefined;
}

function describe(token: Token): string {
  if (isMath(token)) return `math ${displayed(token)} ${token.content}`;
  const attrs = (token.attrs ?? [])
    .filter(([name]) => !name.startsWith("data-"))
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  const children = (token.children ?? []).map(describe).join(" ");
  return `${token.type} ${token.tag} ${attrs} ${token.content} ${children}`;
}

function isMath(token: Token): boolean {
  return token.type === "math_inline" || token.type === "math_block";
}

function displayed(token: Token): boolean {
  return token.type === "math_block" || isDisplayMath(token.markup);
}

function sameRendering(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/** How many formulas were converted, by what they were converted from and to. */
export type Conversions = Record<string, number>;

/**
 * The page's body with its formulas put into `$…$` and `$$…$$`, and what was
 * converted. A conversion is kept only when the page renders the same text
 * and formulas after it (`rendering`), so a scan that misreads the page costs
 * a conversion, never a change to what the page shows: `\(x\)5` stays, since
 * `$x$5` would not be math. Code blocks and code spans are never touched.
 */
export function normalizeMath(body: string): { body: string; converted: Conversions } {
  const tokens = parse(body);
  const found = candidates(body, tokens);
  if (!found.length) return { body, converted: {} };

  const want = rendering(tokens);
  const renders = (picks: Pick[]) => sameRendering(rendering(parse(apply(body, picks))), want);

  // Every formula's likeliest form at once: one more parse, in the usual case.
  let picks: Pick[] = found.map((candidate) => ({ candidate, variant: 0 }));
  if (!renders(picks)) {
    // Each formula on its own, in each form it may take.
    picks = [];
    for (const candidate of found) {
      const variant = candidate.variants.findIndex((_, i) => renders([{ candidate, variant: i }]));
      if (variant >= 0) picks.push({ candidate, variant });
    }
    // Conversions sound one by one may still not be together; keep those that are.
    if (!renders(picks)) {
      const kept: Pick[] = [];
      for (const pick of picks) if (renders([...kept, pick])) kept.push(pick);
      picks = kept;
    }
  }

  const converted: Conversions = {};
  for (const { candidate, variant } of picks) {
    const to = candidate.variants[variant].startsWith("$$") ? "$$…$$" : "$…$";
    const key = `${FORM_LABEL[candidate.form]} → ${to}`;
    converted[key] = (converted[key] ?? 0) + 1;
  }
  return { body: apply(body, picks), converted };
}

/** A formula that does not render, or TeX left in the text. */
export interface MathProblem {
  /** 0-based, in the body checked. */
  line: number;
  snippet: string;
  why: string;
  /** The same for the same problem on another version of the page. */
  key: string;
}

/** What KaTeX says about a formula it cannot read, or undefined when it can. */
function katexError(tex: string, displayMode: boolean): string | undefined {
  try {
    katex.renderToString(tex, { displayMode, throwOnError: true, strict: "ignore" });
    return undefined;
  } catch (err) {
    const raw = (err as { rawMessage?: string }).rawMessage ?? (err as Error).message;
    return String(raw).replace(/^KaTeX parse error: /, "");
  }
}

const known = new Map<string, boolean>();

/**
 * Whether KaTeX has a command by this name. An unknown one is what it calls an
 * undefined control sequence; a known one may still fail alone, for want of
 * its argument, but not that way.
 */
function katexKnows(name: string): boolean {
  let knows = known.get(name);
  if (knows === undefined) {
    try {
      katex.renderToString(`\\${name}`, { throwOnError: true, strict: "ignore" });
      knows = true;
    } catch (err) {
      knows = !String((err as Error).message).includes("Undefined control sequence");
    }
    if (known.size < 2000) known.set(name, knows);
  }
  return knows;
}

/**
 * The TeX commands in text the renderer left as text: names of two letters or
 * more that KaTeX knows, so a Windows path's `\Users` or a regex's `\d` is not
 * one. A word that is a path is passed over whole, since `C:\path\to` holds a
 * `\to`: one starting `C:\`, or holding a name KaTeX does not know, as TeX
 * left in the text would not.
 */
function strayCommands(text: string): { name: string; index: number }[] {
  const found: { name: string; index: number }[] = [];
  for (const word of text.matchAll(/\S+/g)) {
    if (/^[A-Za-z]:\\/.test(word[0])) continue;
    const commands = [...word[0].matchAll(/\\([A-Za-z]{2,})/g)];
    if (!commands.every((command) => katexKnows(command[1]))) continue;
    for (const command of commands) {
      found.push({ name: command[1], index: (word.index ?? 0) + (command.index ?? 0) });
    }
  }
  return found;
}

/** `text` cut to about `max` characters around `at`, with an ellipsis where it was cut. */
function around(text: string, at: number, max = 60): string {
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= max) return flat.trim();
  const start = Math.max(0, Math.min(at - max / 3, flat.length - max));
  const cut = flat.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + max < flat.length ? "…" : ""}`;
}

/** The first line from `range` holding `needle`, or the range's first line. */
function lineOf(lines: string[], range: [number, number], needle: string): number {
  for (let line = range[0]; line < Math.min(range[1], lines.length); line += 1) {
    if (lines[line].includes(needle)) return line;
  }
  return range[0];
}

/** Every formula KaTeX cannot read, and every run of text with TeX left in it. */
export function mathProblems(body: string): MathProblem[] {
  const lines = body.split("\n");
  const problems: MathProblem[] = [];
  let range: [number, number] = [0, 1];

  const formula = (token: Token) => {
    const error = katexError(token.content, displayed(token));
    if (!error) return;
    const firstLine = token.content.split("\n", 1)[0].trim();
    problems.push({
      line: lineOf(lines, range, firstLine.slice(0, 40)),
      snippet: around(token.content, 0, 80),
      why: `KaTeX can't read it (${error}). Correct the TeX`,
      key: `math ${token.content.replace(/\s+/g, " ").trim()}`,
    });
  };
  const text = (token: Token) => {
    const commands = strayCommands(token.content);
    if (!commands.length) return;
    const names = [...new Set(commands.map((command) => `\\${command.name}`))];
    const snippet = around(token.content, commands[0].index);
    problems.push({
      line: lineOf(lines, range, names[0]),
      snippet,
      why:
        `${names.join(", ")} ${names.length > 1 ? "are" : "is"} TeX outside any formula, so ` +
        `${names.length > 1 ? "they show" : "it shows"} as text. Put the formula in $…$, or $$…$$ on lines of its own`,
      key: `text ${snippet}`,
    });
  };

  for (const token of parse(body)) {
    // Cells and list items carry no lines of their own; the row or block before them does.
    if (token.map) range = [token.map[0], token.map[1]];
    if (token.type === "math_block") formula(token);
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "math_inline") formula(child);
      else if (child.type === "text") text(child);
      else if (child.type === "image") for (const alt of child.children ?? []) if (alt.type === "text") text(alt);
    }
  }
  return problems;
}

/** What a page write does with the math in it. */
export interface MathCheck {
  /** The body to save. */
  body: string;
  /** One line on what was converted, when anything was. */
  converted?: string;
  /** Why the write is refused, when it is: problems it would bring to the page. */
  refused?: string;
  /** The problems the page already had, which do not refuse the write. */
  existing?: string;
}

/**
 * Convert a body's math and check what is left, for a write through the MCP
 * server. `previous` is the page's body before the write, whose problems do
 * not refuse it: an unrelated edit to a page that a person or an older version
 * left with a broken formula is not the agent's to answer for, and refusing it
 * would push the agent to rewrite a formula it may not understand. They are
 * reported instead. `lineOffset` is how many lines of frontmatter come before
 * the body, so that lines are counted in what the agent sent.
 */
export function checkPageMath(body: string, opts: { previous?: string; lineOffset?: number } = {}): MathCheck {
  const normalized = normalizeMath(body);
  const check: MathCheck = { body: normalized.body };
  const total = Object.values(normalized.converted).reduce((sum, n) => sum + n, 0);
  if (total) {
    const list = Object.entries(normalized.converted)
      .map(([conversion, n]) => `${n} × ${conversion}`)
      .join(", ");
    check.converted = `Converted ${total} formula${total === 1 ? "" : "s"} to the form crescent keeps (${list}). Write math that way from the start.`;
  }

  const problems = mathProblems(normalized.body);
  if (!problems.length) return check;
  const before = new Map<string, number>();
  for (const problem of opts.previous === undefined ? [] : mathProblems(opts.previous)) {
    before.set(problem.key, (before.get(problem.key) ?? 0) + 1);
  }
  const introduced: MathProblem[] = [];
  const existing: MathProblem[] = [];
  for (const problem of problems) {
    const left = before.get(problem.key) ?? 0;
    if (left) {
      before.set(problem.key, left - 1);
      existing.push(problem);
    } else {
      introduced.push(problem);
    }
  }

  const offset = opts.lineOffset ?? 0;
  const list = (found: MathProblem[]) =>
    found.map((problem) => `\n- line ${problem.line + offset + 1}, \`${problem.snippet}\`: ${problem.why}.`).join("");
  const places = (n: number) => (n === 1 ? "one place" : `${n} places`);
  const codeSpan = "\nTeX shown as an example rather than typeset goes in a code span, which is never checked.";
  if (introduced.length) {
    const one = introduced.length === 1;
    check.refused =
      `Not saved: math would not render in ${places(introduced.length)} on this page. ` +
      "crescent typesets $…$ inline and $$…$$ on lines of their own, with single backslashes. " +
      `Fix ${one ? "it" : "each"} and send the page again:` +
      list(introduced) +
      codeSpan;
  }
  if (existing.length) {
    const one = existing.length === 1;
    check.existing =
      `Saved. The page already had math that does not render in ${places(existing.length)}, which this write left as ${one ? "it was" : "they were"}. ` +
      `Fix ${one ? "it" : "them"} where you can tell what was meant:` +
      list(existing) +
      codeSpan;
  }
  return check;
}
