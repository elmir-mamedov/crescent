import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Content } from "./content.js";
import { imageFileName, isImageName, listImages, saveImage, uploadRefusal } from "./gallery.js";
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("isImageName: raster formats and SVG, in any case; nothing else", () => {
  for (const name of ["a.png", "B.JPG", "c.jpeg", "d.gif", "e.webp", "f.avif", "g.svg"]) {
    assert.equal(isImageName(name), true, name);
  }
  for (const name of ["spec.pdf", "clip.mp4", "notes.txt", "photo.heic", "png", ".gitkeep"]) {
    assert.equal(isImageName(name), false, name);
  }
});

test("imageFileName: lowercase and hyphenated, so it links from Markdown as is", () => {
  assert.equal(imageFileName("Screenshot 2026-10-30 at 21.12.53.PNG", "image/png"), "screenshot-2026-10-30-at-21-12-53.png");
  assert.equal(imageFileName("Diagram (final) [v2].svg", "image/svg+xml"), "diagram-final-v2.svg");
  assert.equal(imageFileName("photo.jpeg", "image/jpeg"), "photo.jpeg");
});

test("imageFileName: an accent keeps its letter", () => {
  assert.equal(imageFileName("Obrázek č. 1.png", "image/png"), "obrazek-c-1.png");
});

test("imageFileName: a name with no letters left is called image", () => {
  assert.equal(imageFileName("截图.png", "image/png"), "image.png");
  assert.equal(imageFileName("!!!.png", "image/png"), "image.png");
});

test("imageFileName: a folder in the name is dropped, never followed", () => {
  assert.equal(imageFileName("../../etc/x.png", "image/png"), "x.png");
  assert.equal(imageFileName("..\\..\\x.png", "image/png"), "x.png");
});

test("imageFileName: no image extension falls back to the file's type", () => {
  assert.equal(imageFileName("pasted", "image/png"), "pasted.png");
  assert.equal(imageFileName("camera", "image/jpeg"), "camera.jpg");
});

test("imageFileName: neither an image extension nor an image type is refused", () => {
  assert.equal(imageFileName("notes.txt", "text/plain"), null);
  assert.equal(imageFileName("page.html", "text/html"), null);
  assert.equal(imageFileName("photo.heic", "image/heic"), null);
});

test("uploadRefusal: names what cannot go in, before anything is written", () => {
  assert.equal(uploadRefusal([]), "Choose an image to upload.");
  assert.match(
    uploadRefusal([
      { name: "a.png", type: "image/png", size: 10 },
      { name: "notes.txt", type: "text/plain", size: 10 },
    ]) ?? "",
    /notes\.txt is not one/
  );
  assert.equal(uploadRefusal([{ name: "a.png", type: "image/png", size: 0 }]), "a.png is empty.");
  assert.equal(uploadRefusal([{ name: "a.png", type: "image/png", size: 10 }]), null);
});

test("listImages: every image in _assets, subfolders included, newest first", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.mkdir(path.join(assets, "diagrams"), { recursive: true });
    await fs.writeFile(path.join(assets, "old.png"), PNG);
    await fs.writeFile(path.join(assets, "diagrams", "flow.svg"), "<svg/>");
    await fs.writeFile(path.join(assets, "spec.pdf"), "%PDF");
    await fs.writeFile(path.join(assets, ".hidden.png"), PNG);
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(assets, "old.png"), past, past);

    const images = await listImages(content, "docs");
    assert.deepEqual(
      images.map((image) => image.path),
      ["diagrams/flow.svg", "old.png"]
    );
    assert.equal(images[1].size, PNG.length);
  });
});

test("listImages: a space without _assets, or no space at all, has none", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.rm(assets, { recursive: true });
    assert.deepEqual(await listImages(content, "docs"), []);
    assert.deepEqual(await listImages(content, "missing"), []);
    assert.deepEqual(await listImages(content, "../docs"), []);
  });
});

test("listImages: follows no symbolic link, to a file or a folder", async (t) => {
  await withSpace(async ({ kb, content, assets }) => {
    const outside = path.join(kb.dir, "..", `${path.basename(kb.dir)}-outside`);
    await fs.mkdir(outside, { recursive: true });
    try {
      await fs.writeFile(path.join(outside, "secret.png"), PNG);
      const linked =
        (await trySymlink(path.join(outside, "secret.png"), path.join(assets, "secret.png"), "file")) &&
        (await trySymlink(outside, path.join(assets, "linked"), "dir"));
      if (!linked) return t.skip("this system makes no file links");
      assert.deepEqual(await listImages(content, "docs"), []);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("listImages: an _assets that is itself a link is not read", async (t) => {
  await withSpace(async ({ kb, content, assets }) => {
    const outside = path.join(kb.dir, "..", `${path.basename(kb.dir)}-outside`);
    await fs.mkdir(outside, { recursive: true });
    try {
      await fs.writeFile(path.join(outside, "secret.png"), PNG);
      await fs.rm(assets, { recursive: true });
      if (!(await trySymlink(outside, assets, "dir"))) return t.skip("this system makes no folder links");
      assert.deepEqual(await listImages(content, "docs"), []);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("saveImage: writes the upload into _assets under its clean name", async () => {
  await withSpace(async ({ content, assets }) => {
    const saved = await saveImage(content, "docs", { name: "My Photo.PNG", type: "image/png" }, PNG);
    assert.equal(saved.path, "my-photo.png");
    assert.equal(saved.fsPath, path.join(assets, "my-photo.png"));
    assert.deepEqual(new Uint8Array(await fs.readFile(saved.fsPath)), PNG);
  });
});

test("saveImage: never replaces an image already there", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.writeFile(path.join(assets, "photo.png"), "original");
    const second = await saveImage(content, "docs", { name: "photo.png", type: "image/png" }, PNG);
    const third = await saveImage(content, "docs", { name: "photo.png", type: "image/png" }, PNG);
    assert.equal(second.path, "photo-2.png");
    assert.equal(third.path, "photo-3.png");
    assert.equal(await fs.readFile(path.join(assets, "photo.png"), "utf8"), "original");
  });
});

test("saveImage: makes _assets when the space has none", async () => {
  await withSpace(async ({ content, assets }) => {
    await fs.rm(assets, { recursive: true });
    const saved = await saveImage(content, "docs", { name: "a.png", type: "image/png" }, PNG);
    assert.equal(saved.fsPath, path.join(assets, "a.png"));
  });
});

test("saveImage: refuses a space that does not exist, and a file that is not an image", async () => {
  await withSpace(async ({ kb, content }) => {
    await assert.rejects(
      saveImage(content, "missing", { name: "a.png", type: "image/png" }, PNG),
      /no space named "missing"/
    );
    await assert.rejects(saveImage(content, "docs", { name: "x.html", type: "text/html" }, PNG), /not an image/);
    await assert.rejects(fs.access(path.join(kb.dir, "missing")));
  });
});

test("saveImage: writes nothing through an _assets that is a link", async (t) => {
  await withSpace(async ({ kb, content, assets }) => {
    const outside = path.join(kb.dir, "..", `${path.basename(kb.dir)}-outside`);
    await fs.mkdir(outside, { recursive: true });
    try {
      await fs.rm(assets, { recursive: true });
      if (!(await trySymlink(outside, assets, "dir"))) return t.skip("this system makes no folder links");
      await assert.rejects(saveImage(content, "docs", { name: "a.png", type: "image/png" }, PNG), /not a folder/);
      assert.deepEqual(await fs.readdir(outside), []);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("saveImage: a link where the name would go is passed over, not written through", async (t) => {
  await withSpace(async ({ kb, content, assets }) => {
    const outside = path.join(kb.dir, "..", `${path.basename(kb.dir)}-outside.png`);
    await fs.writeFile(outside, "untouched");
    try {
      if (!(await trySymlink(outside, path.join(assets, "a.png"), "file"))) return t.skip("this system makes no file links");
      const saved = await saveImage(content, "docs", { name: "a.png", type: "image/png" }, PNG);
      assert.equal(saved.path, "a-2.png");
      assert.equal(await fs.readFile(outside, "utf8"), "untouched");
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});
