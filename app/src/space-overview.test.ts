import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { spaceNodes } from "./labels.js";
import { countSpaceDiagrams, countWidgets } from "./space-overview.js";
import { makeTempKb, trySymlink, type TempKb } from "./test-helpers.js";

async function withSpace(
  run: (ctx: { kb: TempKb; content: Content; assets: string }) => Promise<void>
): Promise<void> {
  const kb = await makeTempKb();
  try {
    const content = new Content(kb.dir);
    await content.createSpace("Docs");
    await run({ kb, content, assets: path.join(kb.dir, "docs", "_assets") });
  } finally {
    await kb.cleanup();
  }
}

const diagram = (kind: string) => `\`\`\`mermaid\n${kind}\n\`\`\`\n`;

test("countSpaceDiagrams: every diagram on the space's pages, its home page included", async () => {
  await withSpace(async ({ kb, content }) => {
    await fs.writeFile(
      path.join(kb.dir, "docs", "index.md"),
      `---\ntitle: Docs\n---\n\n${diagram("flowchart LR")}`
    );
    await content.createPage("docs", "Guide", `# Guide\n\n${diagram("pie")}\n${diagram("graph TD")}`);
    await content.createPage("docs/guide", "Intro", `# Intro\n\n${diagram("sequenceDiagram")}`);
    await content.createFolder("docs", "Runbooks");
    await content.createPage("docs/runbooks", "Deploy", "# Deploy\n\n```sh\nnpm start\n```\n");

    assert.equal(await countSpaceDiagrams(content, await spaceNodes(content, "docs", "live")), 4);
  });
});

test("countSpaceDiagrams: an archived page's diagrams count only where archived pages do", async () => {
  await withSpace(async ({ content }) => {
    await content.createPage("docs", "Kept", diagram("pie"));
    await content.createPage("docs", "Old", diagram("pie"));
    await content.updateArchive("docs/old", true);

    assert.equal(await countSpaceDiagrams(content, await spaceNodes(content, "docs", "live")), 1);
    assert.equal(await countSpaceDiagrams(content, await spaceNodes(content, "docs", "all")), 2);
  });
});

test("countSpaceDiagrams: a page that cannot be read draws none", async () => {
  await withSpace(async ({ kb, content }) => {
    await content.createPage("docs", "Good", diagram("pie"));
    await fs.writeFile(path.join(kb.dir, "docs", "broken.md"), `---\ntitle: [unclosed\n---\n\n${diagram("pie")}`);

    assert.equal(await countSpaceDiagrams(content, await spaceNodes(content, "docs", "live")), 1);
  });
});

test("countWidgets: the HTML files in _assets, subfolders included, and nothing else", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.mkdir(path.join(assets, "figures"), { recursive: true });
    await fs.writeFile(path.join(assets, "tcp.html"), "<p>tcp</p>");
    await fs.writeFile(path.join(assets, "figures", "Orbit.HTML"), "<p>orbit</p>");
    await fs.writeFile(path.join(assets, "flow.svg"), "<svg/>");
    await fs.writeFile(path.join(assets, "table.csv"), "a,b\n");
    await fs.writeFile(path.join(assets, "notes.htm"), "<p>not a widget</p>");
    await fs.writeFile(path.join(assets, ".draft.html"), "<p>hidden</p>");

    assert.equal(await countWidgets(content, "docs"), 2);
  });
});

test("countWidgets: a space without _assets, or no space at all, has none", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.rm(assets, { recursive: true, force: true });
    assert.equal(await countWidgets(content, "docs"), 0);
    assert.equal(await countWidgets(content, "missing"), 0);
    assert.equal(await countWidgets(content, "../docs"), 0);
  });
});

test("countWidgets: follows no symbolic link, to a file or a folder", async (t) => {
  await withSpace(async ({ kb, content, assets }) => {
    const outside = path.join(kb.dir, "..", `${path.basename(kb.dir)}-outside`);
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(assets, { recursive: true });
    try {
      await fs.writeFile(path.join(outside, "secret.html"), "<p>secret</p>");
      const linked =
        (await trySymlink(path.join(outside, "secret.html"), path.join(assets, "secret.html"), "file")) &&
        (await trySymlink(outside, path.join(assets, "linked"), "dir"));
      if (!linked) return t.skip("this system makes no file links");
      assert.equal(await countWidgets(content, "docs"), 0);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
