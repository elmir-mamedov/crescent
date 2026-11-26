import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePage } from "./frontmatter.js";
import { EXAMPLE_SPACE } from "./example-space.js";
import { GUIDE_SPACE, guideRoot } from "./guide.js";
import { extractSections } from "./markdown.js";
import { checkPageMath } from "./math-normalize.js";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE = guideRoot(APP_DIR);

/** Every page of the shipped guide. */
function guidePages(): { file: string; raw: string }[] {
  return fs
    .readdirSync(path.join(GUIDE, GUIDE_SPACE), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return { file, raw: fs.readFileSync(file, "utf8") };
    });
}

test("the guide's pages link only to each other, and their math renders", () => {
  const pages = guidePages().map((page) => ({ ...page, ...parsePage(page.raw, page.file) }));
  assert.ok(pages.some((page) => path.basename(page.file) === "index.md"), "the guide has no index.md");
  const byId = new Map<string, (typeof pages)[number]>();
  for (const page of pages) {
    assert.ok(page.data.id, `${page.file} has no id`);
    assert.ok(!byId.has(page.data.id!), `${page.file} reuses the id ${page.data.id}`);
    byId.set(page.data.id!, page);
  }

  let links = 0;
  for (const page of pages) {
    for (const [, id, anchor] of page.body.matchAll(/\[\[id:([a-z0-9]+)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]/g)) {
      links++;
      const target = byId.get(id);
      assert.ok(target, `${page.file} links to ${id}, which is not a page of the guide`);
      if (anchor) {
        const anchors = extractSections(target.body).map((section) => section.anchor);
        assert.ok(anchors.includes(anchor), `${page.file} links to a missing section ${id}#${anchor}`);
      }
    }
    // A slug link would point at wherever the guide sits, which differs
    // between Help and a knowledge base: the guide links by id alone.
    assert.doesNotMatch(page.body.replace(/`[^`]*`/g, ""), /\[\[(?!id:)/, `${page.file} links by slug`);
    const math = checkPageMath(page.body);
    assert.equal(math.refused, undefined, `${page.file}: ${math.refused}`);
    assert.equal(math.converted, undefined, `${page.file}: ${math.converted}`);
  }
  assert.ok(links > 0, "found no links to check");
});

test("Help's guide is read-only, and its links stay inside it", async () => {
  const { default: Fastify } = await import("fastify");
  const { registerGuideRoutes } = await import("./server/guide.js");
  const app = Fastify();
  registerGuideRoutes(app, { guideDir: GUIDE });
  try {
    const start = await app.inject({ method: "GET", url: "/_guide" });
    assert.equal(start.statusCode, 302);
    assert.equal(start.headers.location, `/_guide/${GUIDE_SPACE}`);

    for (const page of guidePages()) {
      const rel = path.relative(path.join(GUIDE, GUIDE_SPACE), page.file).replace(/\\/g, "/");
      const slug = rel === "index.md" ? GUIDE_SPACE : `${GUIDE_SPACE}/${rel.replace(/\.md$/, "")}`;
      const res = await app.inject({ method: "GET", url: `/_guide/${slug}` });
      assert.equal(res.statusCode, 200, slug);
      const html = res.body;
      assert.match(html, new RegExp(`<h1>${parsePage(page.raw, page.file).data.title}</h1>`));
      // Nothing on it changes or deletes it.
      assert.doesNotMatch(html, /href="\/_(edit|delete|diff)\/|action="\/_(archive|restore)/);
      // Every link to a page goes to another page of this guide, not into the
      // knowledge base, where the copy may be changed or gone.
      for (const [, href] of html.matchAll(/<a href="(\/[^"]*)"/g)) {
        if (href === "/") continue; // back to the knowledge base, on purpose
        assert.ok(href.startsWith(`/_guide/${GUIDE_SPACE}`), `${slug} links to ${href}`);
      }
    }

    const writing = (await app.inject({ method: "GET", url: `/_guide/${GUIDE_SPACE}/writing-pages` })).body;
    assert.match(writing, /\/_vendor\/katex\/katex\.min\.css/);
    assert.match(writing, /\/_vendor\/mermaid\/mermaid\.min\.js/);
    assert.match(writing, /class="active" aria-current="page">Writing pages</);

    assert.equal((await app.inject({ method: "GET", url: "/_guide/no-such-page" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/_guide/other-space/page" })).statusCode, 404);
  } finally {
    await app.close();
  }
});

test("the first visit after the example space was added goes to it, with the tour, once", async () => {
  const { default: Fastify } = await import("fastify");
  const { registerGuideRoutes } = await import("./server/guide.js");
  for (const startTour of [true, false]) {
    const app = Fastify();
    registerGuideRoutes(app, { guideDir: GUIDE, startTour });
    app.get("/", async () => "spaces");
    try {
      const first = await app.inject({ method: "GET", url: "/" });
      if (startTour) {
        assert.equal(first.statusCode, 302);
        assert.equal(first.headers.location, `/${EXAMPLE_SPACE}?tour=start`);
      } else {
        assert.equal(first.body, "spaces");
      }
      assert.equal((await app.inject({ method: "GET", url: "/" })).body, "spaces");
    } finally {
      await app.close();
    }
  }
});

test("the tour's script parses, Help offers it, and every stop points at something crescent draws", async () => {
  const { TOUR_HELP_BUTTON, TOUR_SCRIPT } = await import("./views/tour.js");
  assert.doesNotThrow(() => new Function(TOUR_SCRIPT));
  assert.match(TOUR_HELP_BUTTON, /data-tour-start/);

  const viewsDir = path.join(APP_DIR, "src", "views");
  const markup = fs
    .readdirSync(viewsDir)
    .filter((name) => name.endsWith(".ts") && name !== "tour.ts" && name !== "styles.ts")
    .map((name) => fs.readFileSync(path.join(viewsDir, name), "utf8"))
    .join("\n");
  assert.match(markup, /\$\{TOUR_HELP_BUTTON\}/, "Help no longer shows Take the tour");
  assert.match(markup, /<script>\$\{TOUR_SCRIPT\}<\/script>/, "no page runs the tour");

  const selectors = [...TOUR_SCRIPT.matchAll(/target: (\[[^\]]+\]|"[^"]+")/g)].flatMap(([, list]) =>
    [...list.matchAll(/"([^"]+)"/g)].map(([, selector]) => selector)
  );
  assert.ok(selectors.length >= 10, `found only ${selectors.length} stops`);
  for (const selector of selectors) {
    // Each class or data attribute a stop selects by must still be in the markup.
    for (const [, kind, name] of selector.matchAll(/([.[])([a-z][a-z-]*)/g)) {
      const needle = kind === "." ? new RegExp(`class="[^"]*\\b${name}\\b`) : new RegExp(`\\b${name}\\b`);
      assert.match(markup, needle, `the tour's stop "${selector}" looks for ${kind}${name}, which no view draws`);
    }
  }
});
