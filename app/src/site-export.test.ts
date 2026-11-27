import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { Content, type PageNode } from "./content.js";
import { exportSite, fillEmbeds, rewriteHtml, siteFilename, sitePages } from "./site-export.js";
import { relativeHref, siteWidget } from "./views/site.js";
import { makeTempKb } from "./test-helpers.js";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The files in a zip archive, by name. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    const method = archive.readUInt16LE(at + 10);
    const nameLength = archive.readUInt16LE(at + 28);
    const extra = archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const body = archive.subarray(start, start + archive.readUInt32LE(offset + 18));
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    at += 46 + nameLength + extra;
  }
  return files;
}

function node(slug: string, title: string, children: PageNode[] = []): PageNode {
  return { slug, title, children, fsPath: "", isSection: children.length > 0, isFolder: false, archived: false };
}

test("a site puts its root at index.html, a page with pages under it at <path>/index.html", () => {
  const site = sitePages(
    node("phys", "Physics", [node("phys/guide", "Guide", [node("phys/guide/step", "Step")]), node("phys/leaf", "Leaf")])
  );
  assert.equal(site.file, "index.html");
  assert.deepEqual(
    site.children.map((page) => page.file),
    ["guide/index.html", "leaf.html"]
  );
  assert.equal(site.children[0].children[0].file, "guide/step.html");
});

test("relativeHref leads from one file of the site to another, encoded", () => {
  assert.equal(relativeHref("index.html", "guide/index.html"), "guide/index.html");
  assert.equal(relativeHref("guide/step.html", "index.html"), "../index.html");
  assert.equal(relativeHref("guide/step.html", "guide/index.html"), "index.html");
  assert.equal(relativeHref("guide/step.html", "_assets/my file é.png"), "../_assets/my%20file%20%C3%A9.png");
  assert.equal(relativeHref("leaf.html", "leaf.html"), "leaf.html");
});

test("rewriteHtml points links into the site, keeps outside links and drops the rest", () => {
  const rw = {
    slug: "phys/guide/step",
    file: "guide/step.html",
    space: "phys",
    files: new Map([
      ["phys", "index.html"],
      ["phys/guide/step", "guide/step.html"],
    ]),
    assets: new Set<string>(),
    svgs: new Set<string>(),
    widgets: new Set<string>(),
  };
  const html = rewriteHtml(
    [
      '<p data-src-line="0" data-src-hash="ab">',
      '<a href="/phys#top" class="wikilink">Home</a>',
      '<a href="/phys/guide/step#a-b">here</a>',
      '<a href="/other/page">Elsewhere <em>far</em></a>',
      '<a href="/id:zzz" class="wikilink broken">gone</a>',
      '<a href="https://example.com/?a=1&amp;b=2">web</a>',
      '<a class="section-link" href="#x" data-copy-slug="phys/guide/step#x" data-copy-label="Section link"></a>',
      '<img src="/phys/_assets/pic%20one.png" alt="p">',
      '<img src="/phys/_assets/fig.svg" alt="f">',
      '<iframe class="widget-frame" src="/_embed/phys/_assets/w.html" sandbox="allow-scripts"></iframe>',
      '<a href="/phys/_assets/../../secret">bad</a>',
      '<a href="/phys/_assets/sim.html">the simulation</a>',
      '<a href="/phys/_assets/notes.pdf">notes</a>',
      '<a href="../guide/step#a">relative</a>',
      '<a href="../../phys">up</a>',
      '<a href="step-two">a page left out</a>',
      '<a href="mailto:a@b.c">mail</a>',
      '<a href="/phys/guide/step#x$&amp;y">dollars</a>',
      '<a class="section-link" href="#y" aria-label="Copy link to section: Why"></a>',
      "</p>",
    ].join(""),
    rw
  );
  assert.match(html, /<a href="..\/index.html#top" class="wikilink">Home<\/a>/);
  assert.match(html, /<a href="step.html#a-b">here<\/a>/);
  assert.match(html, /<span class="site-unlinked">Elsewhere <em>far<\/em><\/span>/);
  assert.match(html, /<span class="site-unlinked">gone<\/span>/);
  assert.match(html, /<a href="https:\/\/example.com\/\?a=1&amp;b=2">web<\/a>/);
  assert.match(html, /<a class="section-link" href="#x"><\/a>/);
  assert.match(html, /<img src="..\/_assets\/pic%20one.png" alt="p">/);
  assert.match(html, /<img data-site-svg="fig.svg" alt="f">/);
  assert.match(html, /<iframe class="widget-frame" data-site-widget="w.html" sandbox="allow-scripts">/);
  assert.match(html, /<span class="site-unlinked">bad<\/span>/);
  // A file a browser could run is never linked, since a static host would run it as its own page.
  assert.match(html, /<span class="site-unlinked">the simulation<\/span>/);
  assert.match(html, /<a href="..\/_assets\/notes.pdf">notes<\/a>/);
  // A relative link is read as crescent reads it on the page's own address.
  assert.match(html, /<a href="step.html#a">relative<\/a>/);
  assert.match(html, /<a href="..\/index.html">up<\/a>/);
  assert.match(html, /<span class="site-unlinked">a page left out<\/span>/);
  assert.match(html, /<a href="mailto:a@b.c">mail<\/a>/);
  // A "$&" in an address is kept as written, not read as a replacement pattern.
  assert.match(html, /<a href="step.html#x\$&amp;y">dollars<\/a>/);
  // A section link only jumps to its heading in the site.
  assert.match(html, /<a class="section-link" href="#y" aria-label="Link to section: Why"><\/a>/);
  assert.doesNotMatch(html, /data-(?!site-)/);
  assert.deepEqual([...rw.assets].sort(), ["notes.pdf", "pic one.png"]);
  assert.deepEqual([...rw.svgs], ["fig.svg"]);
  assert.deepEqual([...rw.widgets], ["w.html"]);
});

test("fillEmbeds puts an SVG in as a data: image and a widget in as its frame's srcdoc", () => {
  const html = fillEmbeds(
    '<img data-site-svg="fig.svg" alt="f"><iframe class="widget-frame" data-site-widget="w.html" sandbox="allow-scripts"></iframe><img data-site-svg="gone.svg">',
    new Map([["fig.svg", Buffer.from("<svg/>")]]),
    new Map([["w.html", '<p title="a">&</p>']])
  );
  assert.match(html, /<img src="data:image\/svg\+xml;base64,PHN2Zy8\+" alt="f">/);
  assert.match(html, /<iframe class="widget-frame" srcdoc="&lt;p title=&quot;a&quot;&gt;&amp;&lt;\/p&gt;" sandbox="allow-scripts">/);
  assert.match(html, /<img src="">$/);
});

test("a widget in the site has the network shut off, as crescent serves it", () => {
  const doc = siteWidget("<p>hi</p>");
  assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline';/);
  assert.match(doc, /<p>hi<\/p>$/);
});

test("siteFilename names the zip after its root", () => {
  assert.equal(siteFilename("phys/guide"), "guide-website.zip");
  assert.equal(siteFilename("phys"), "phys-website.zip");
});

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

test("exportSite zips the live pages under a page, with their files, and nothing of crescent's tools", async () => {
  const kb = await makeTempKb();
  try {
    const phys = path.join(kb.dir, "phys");
    await write(path.join(phys, "index.md"), "---\ntitle: Physics\nid: phy000000000\n---\nStart at [[id:stp000000000|the step]].\n");
    await write(path.join(phys, "guide", "index.md"), "---\ntitle: Guide\nid: gui000000000\n---\nA guide.\n");
    await write(
      path.join(phys, "guide", "step.md"),
      [
        "---",
        "title: Step",
        "id: stp000000000",
        "tags: [secret-tag]",
        "labels: [Draft]",
        "---",
        "Energy $E = mc^2$.",
        "",
        "![pic](_assets/pic.png)",
        "",
        "![A widget](_assets/w.html)",
        "",
        "Back [[phys|home]], over to [[other/page|another space]], and [[phys/old|an archived page]].",
        "",
        ":::tabs",
        "@tab One",
        "first",
        "@tab Two",
        "second",
        ":::",
        "<!-- kb25:note id=n1 kind=remark at=2026-01-01T00:00:00Z by=me",
        "> Energy",
        "",
        "A private remark.",
        "-->",
      ].join("\n")
    );
    await write(path.join(phys, "old.md"), "---\ntitle: Old\narchived: true\n---\nOld.\n");
    await write(path.join(phys, "box", "index.md"), "---\ntitle: Box\ntype: folder\n---\n");
    await write(path.join(phys, "box", "inner.md"), "---\ntitle: Inner\n---\nInside.\n");
    await write(path.join(phys, "_assets", "pic.png"), "PNG");
    await write(path.join(phys, "_assets", "unused.png"), "PNG");
    await write(path.join(phys, "_assets", "w.html"), "<p>widget</p>");
    await write(path.join(kb.dir, "other", "index.md"), "---\ntitle: Other\n---\n");
    await write(path.join(kb.dir, "other", "page.md"), "---\ntitle: Page\n---\nOther.\n");

    const site = await exportSite(new Content(kb.dir), "phys", APP_DIR);
    assert.ok(site);
    assert.equal(site.filename, "phys-website.zip");
    const files = unzip(site.body);
    const names = [...files.keys()];
    for (const name of ["index.html", "guide/index.html", "guide/step.html", "_assets/pic.png", "_crescent/crescent.css", "_crescent/katex/katex.min.css", "_crescent/LICENSE", "_crescent/NOTICE", "_crescent/THIRD_PARTY_NOTICES.txt"]) {
      assert.ok(names.includes(name), `${name} is in the site`);
    }
    assert.ok(!names.some((name) => /^old\.html$|unused|mermaid|^other/.test(name)), names.join(", "));

    const notices = files.get("_crescent/THIRD_PARTY_NOTICES.txt")!.toString("utf8");
    assert.match(notices, /^ {2}katex /m);
    assert.doesNotMatch(notices, /^ {2}mermaid /m, "no Mermaid on any page, so no notice for it");

    const home = files.get("index.html")!.toString("utf8");
    assert.match(home, /<a href="guide\/step.html" class="wikilink">the step<\/a>/);
    assert.match(home, /Made with <a href="https:\/\/github.com\/elmir-mamedov\/crescent">crescent<\/a>/);
    assert.doesNotMatch(home, /katex.min.css/, "a page with no math loads no KaTeX");
    assert.doesNotMatch(home, /kb25Reveal/, "a page with no tabs or sections carries no script for them");

    assert.match(files.get("box/index.html")!.toString("utf8"), /<ul class="site-folder"><li><a href="inner.html">Inner<\/a><\/li><\/ul>/);

    const step = files.get("guide/step.html")!.toString("utf8");
    assert.match(step, /<link rel="stylesheet" href="..\/_crescent\/crescent.css" \/>/);
    assert.match(step, /<link rel="stylesheet" href="..\/_crescent\/katex\/katex.min.css" \/>/);
    assert.match(step, /<img src="..\/_assets\/pic.png" alt="pic"/);
    assert.match(step, /<iframe class="widget-frame"[^>]* srcdoc="[^"]*&lt;p&gt;widget&lt;\/p&gt;"/);
    assert.match(step, /<a href="..\/index.html" class="wikilink">home<\/a>/);
    assert.match(step, /<span class="site-unlinked">another space<\/span>/);
    assert.match(step, /<span class="site-unlinked">an archived page<\/span>/);
    // Its tabs work as in crescent: the script that makes the row of tabs comes with the page.
    assert.match(step, /<div class="tabs-block">/);
    assert.match(step, /window\.kb25Reveal = /);
    assert.match(step, /<a href="step.html" aria-current="page">Step<\/a>/);
    assert.doesNotMatch(step, /A private remark|secret-tag|Draft|data-src|\/_vendor|\/_embed|href="\//);
  } finally {
    await kb.cleanup();
  }
});

test("exportSite puts no file a browser could run in the site, and survives a page it can't read", async () => {
  const kb = await makeTempKb();
  try {
    const phys = path.join(kb.dir, "phys");
    await write(path.join(phys, "index.md"), "---\ntitle: Physics\n---\nSee [the simulation](_assets/sim.html).\n\n![A figure](_assets/fig.svg)\n\n![A widget](_assets/w.html)\n");
    await write(path.join(phys, "broken.md"), "---\ntitle: [unclosed\n---\nText.\n");
    await write(path.join(phys, "_assets", "sim.html"), "<script>steal()</script>");
    await write(path.join(phys, "_assets", "fig.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>');
    await write(path.join(phys, "_assets", "w.html"), "<p>widget</p>");

    const site = await exportSite(new Content(kb.dir), "phys", APP_DIR);
    assert.ok(site);
    const files = unzip(site.body);
    const names = [...files.keys()];
    assert.ok(!names.some((name) => /\.(svg|xml|xhtml|htm)$/i.test(name) || name.startsWith("_widgets/")), names.join(", "));
    assert.deepEqual(names.filter((name) => name.endsWith(".html")).sort(), ["broken.html", "index.html"]);

    const home = files.get("index.html")!.toString("utf8");
    assert.match(home, /<span class="site-unlinked">the simulation<\/span>/);
    assert.match(home, /<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="A figure"/);
    assert.match(home, /<iframe class="widget-frame"[^>]* srcdoc="[^"]*Content-Security-Policy[^"]*&lt;p&gt;widget&lt;\/p&gt;"[^>]* sandbox="allow-scripts"|<iframe class="widget-frame"[^>]* sandbox="allow-scripts"[^>]* srcdoc="[^"]*Content-Security-Policy[^"]*&lt;p&gt;widget&lt;\/p&gt;"/);
    assert.match(files.get("broken.html")!.toString("utf8"), /header couldn't be read/);
  } finally {
    await kb.cleanup();
  }
});

test("exportSite writes a folder with no index.md, a picture from another space as its text, and Mermaid's notices", async () => {
  const kb = await makeTempKb();
  try {
    const phys = path.join(kb.dir, "phys");
    await write(
      path.join(phys, "index.md"),
      "---\ntitle: Physics\n---\n![Their figure](/other/_assets/p.png)\n\n```mermaid\ngraph LR\n  A --> B\n```\n"
    );
    await write(path.join(phys, "loose", "note.md"), "---\ntitle: Note\n---\nBack [up](..), or [down here](note#below).\n");
    await write(path.join(kb.dir, "other", "_assets", "p.png"), "PNG");

    const site = await exportSite(new Content(kb.dir), "phys", APP_DIR);
    assert.ok(site);
    const files = unzip(site.body);
    assert.match(files.get("loose/index.html")!.toString("utf8"), /<ul class="site-folder"><li><a href="note.html">Note<\/a><\/li><\/ul>/);
    const note = files.get("loose/note.html")!.toString("utf8");
    assert.match(note, /<a href="..\/index.html">up<\/a>/);
    assert.match(note, /<a href="note.html#below">down here<\/a>/);
    const home = files.get("index.html")!.toString("utf8");
    assert.match(home, /<span class="site-unlinked">Their figure<\/span>/);
    assert.ok(![...files.keys()].some((name) => name.includes("p.png")));
    // From a checkout too, the notices cover what mermaid.min.js carries inside it.
    const notices = files.get("_crescent/THIRD_PARTY_NOTICES.txt")!.toString("utf8");
    for (const name of ["mermaid", "dompurify", "d3"]) assert.match(notices, new RegExp(`^ {2}${name} `, "m"), name);
  } finally {
    await kb.cleanup();
  }
});

test("exportSite has no site for a page that isn't there or is archived", async () => {
  const kb = await makeTempKb();
  try {
    await write(path.join(kb.dir, "phys", "index.md"), "---\ntitle: Physics\n---\n");
    await write(path.join(kb.dir, "phys", "old.md"), "---\ntitle: Old\narchived: true\n---\n");
    const content = new Content(kb.dir);
    assert.equal(await exportSite(content, "phys/missing", APP_DIR), null);
    assert.equal(await exportSite(content, "phys/old", APP_DIR), null);
  } finally {
    await kb.cleanup();
  }
});
