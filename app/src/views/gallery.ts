import type { PageNode, SpaceInfo } from "../content.js";
import { IMAGE_ACCEPT, type GalleryImage } from "../gallery.js";
import type { LabelDef } from "../labels.js";
import { escapeHtml, galleryHref } from "./html.js";
import { layout, type ViewNotice } from "./page.js";

/**
 * A space's image gallery. gallery.ts on the server lists the images and takes
 * the uploads.
 */

export interface GalleryView {
  siteTitle: string;
  spaces: SpaceInfo[];
  spaceKey: string;
  tree: PageNode[];
  labelSet?: LabelDef[];
  titles: Map<string, string>;
  spaceTitle: string;
  images: GalleryImage[];
  /** Paths (inside `_assets`) of the images just uploaded, marked in the grid. */
  added?: string[];
  notice?: ViewNotice;
  username?: string | null;
}

/** A file size the way a person reads it: `830 KB`, `2.4 MB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The URL an image in a space's `_assets` is served at, each part encoded. */
function assetHref(spaceKey: string, rel: string): string {
  return `/${encodeURIComponent(spaceKey)}/_assets/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The gallery: every image in one space's `_assets`, used on a page or not,
 * and the form that uploads more. The caption under each is the reference a
 * page's Markdown uses, which for now is the only way onto a page.
 *
 * A thumbnail is a link to the image itself, so it opens with scripts off;
 * GALLERY_SCRIPT shows it in a dialog instead, which keeps a desktop window
 * on the gallery. The upload is a plain multipart form for the same reason.
 */
export function galleryLayout(v: GalleryView): string {
  const added = new Set(v.added ?? []);
  const count = v.images.length;
  const tiles = v.images
    .map((image) => {
      const href = escapeHtml(assetHref(v.spaceKey, image.path));
      const ref = escapeHtml(`_assets/${image.path}`);
      const name = escapeHtml(image.path.split("/").pop() ?? image.path);
      const size = escapeHtml(formatSize(image.size));
      return `<li class="gallery-item${added.has(image.path) ? " is-new" : ""}">
      <a class="gallery-thumb" href="${href}" data-gallery-open data-name="${name}" data-ref="${ref}" data-size="${size}" aria-label="View ${name}">
        <img src="${href}" alt="" loading="lazy" decoding="async" />
      </a>
      <code class="gallery-ref" title="${ref}">${ref}</code>
      <span class="gallery-size">${size}</span>
    </li>`;
    })
    .join("\n    ");

  const grid = count
    ? `<p class="gallery-count">${count} ${count === 1 ? "image" : "images"}</p>
  <ul class="gallery-grid">
    ${tiles}
  </ul>`
    : `<p class="dash-empty">No images in <strong>${escapeHtml(v.spaceTitle)}</strong> yet. Upload one to start.</p>`;

  return layout({
    siteTitle: v.siteTitle,
    spaces: v.spaces,
    spaceKey: v.spaceKey,
    tree: v.tree,
    labelSet: v.labelSet,
    activeSlug: "",
    titles: v.titles,
    title: `${v.spaceTitle} · Gallery`,
    contentHtml: `<div class="gallery">
  <div class="gallery-bar">
    <p class="dash-lede">Every image in this space's <code>_assets</code> folder, whether a page shows it or not. To show one on a page, edit the page and add <code>![](_assets/name.png)</code> to its Markdown.</p>
    <form class="gallery-upload" method="post" action="${escapeHtml(galleryHref(v.spaceKey))}" enctype="multipart/form-data" data-gallery-upload>
      <label class="button primary">
        <input type="file" name="image" accept="${escapeHtml(IMAGE_ACCEPT)}" multiple required data-gallery-file />
        <span data-gallery-upload-label>Upload images</span>
      </label>
      <noscript><button class="button secondary" type="submit">Upload</button></noscript>
    </form>
  </div>
  ${grid}
</div>
<dialog class="gallery-viewer" data-gallery-viewer tabindex="-1">
  <form method="dialog" class="help-head">
    <h2 data-gallery-viewer-name></h2>
    <button class="help-close" aria-label="Close" value="close">&times;</button>
  </form>
  <div class="gallery-viewer-frame"><img data-gallery-viewer-img alt="" /></div>
  <p class="gallery-viewer-meta"><code data-gallery-viewer-ref></code> · <span data-gallery-viewer-size></span></p>
</dialog>
<script>${GALLERY_SCRIPT}</script>`,
    notice: v.notice,
    canEdit: false,
    username: v.username,
  });
}

/**
 * Choosing files sends them at once, with no second Upload click; and a
 * thumbnail opens in the dialog rather than leaving the page. A click with a
 * modifier key still opens the image the browser's way.
 */
const GALLERY_SCRIPT = `
(() => {
  const form = document.querySelector("[data-gallery-upload]");
  const input = form && form.querySelector("[data-gallery-file]");
  if (form && input) {
    input.addEventListener("change", () => {
      if (!input.files || !input.files.length) return;
      const label = form.querySelector("[data-gallery-upload-label]");
      if (label) label.textContent = "Uploading…";
      form.classList.add("is-busy");
      form.submit();
    });
  }

  const viewer = document.querySelector("[data-gallery-viewer]");
  if (!viewer || typeof viewer.showModal !== "function") return;
  const img = viewer.querySelector("[data-gallery-viewer-img]");
  const name = viewer.querySelector("[data-gallery-viewer-name]");
  const ref = viewer.querySelector("[data-gallery-viewer-ref]");
  const size = viewer.querySelector("[data-gallery-viewer-size]");
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-gallery-open]") : null;
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    img.src = link.href;
    name.textContent = link.dataset.name || "";
    ref.textContent = link.dataset.ref || "";
    size.textContent = link.dataset.size || "";
    viewer.showModal();
    // Not its close button, which would wear a focus ring until clicked away.
    viewer.focus();
  });
  // A click on the backdrop lands on the dialog itself.
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener("close", () => img.removeAttribute("src"));
})();
`;
