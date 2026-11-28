/**
 * Mermaid diagrams: the script that draws them, and the viewer that opens one,
 * or a page's image, large. DIAGRAM_MODEL is the viewer's zoom and bounds,
 * which the tests run on their own.
 */

/**
 * Loads Mermaid from the app's own bundle and renders every `<pre class="mermaid">`
 * container into an SVG diagram. Injected only on pages that contain one (see
 * `layout`). `securityLevel: "strict"` keeps Mermaid's DOMPurify sanitizer on,
 * matching the viewer's no-raw-HTML posture. The `<script>` sits at the end of
 * <body>, so all diagram containers are already in the DOM when it runs.
 *
 * The diagram theme follows the page theme. Because Mermaid bakes colors into the
 * generated SVG, we stash each container's source and expose `window.__renderMermaid`,
 * which re-initializes with the current theme and re-renders — `THEME_SCRIPT` calls
 * it on every toggle so on-screen diagrams re-color live.
 */
export const MERMAID_SCRIPT = `<script src="/_vendor/mermaid/mermaid.min.js"></script>
<script>
  (() => {
    const nodes = Array.from(document.querySelectorAll("pre.mermaid"));
    nodes.forEach((n) => { if (n.dataset.src === undefined) n.dataset.src = n.textContent; });
    window.__renderMermaid = () => {
      if (typeof mermaid === "undefined") return;
      const dark = document.documentElement.dataset.theme === "dark";
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      nodes.forEach((n) => { n.textContent = n.dataset.src; n.removeAttribute("data-processed"); n.dataset.drawn = dark ? "dark" : "light"; });
      mermaid.run({ nodes });
    };
    window.__renderMermaid();
    // Each diagram drawn for the dark theme drawn again in the light one, into
    // a copy beside it that only print shows (PRINT_SCRIPT), so a PDF is light
    // and the page on screen stays as it is. Off screen while Mermaid measures
    // it, since it cannot lay out a diagram that is not shown.
    let round = 0;
    window.__drawMermaidForPrint = async () => {
      if (typeof mermaid === "undefined") return;
      round += 1;
      const stage = document.createElement("div");
      stage.style.cssText = "position:fixed; left:-10000px; top:0; width:1200px; visibility:hidden";
      document.body.append(stage);
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      try {
        for (const [i, n] of nodes.entries()) {
          let copy = n.previousElementSibling;
          if (!copy || !copy.classList.contains("mermaid-print")) {
            copy = document.createElement("div");
            copy.className = "mermaid-print";
            n.before(copy);
          }
          n.removeAttribute("data-print-copy");
          copy.textContent = "";
          if (n.dataset.drawn !== "dark") continue;
          try {
            const { svg } = await mermaid.render("kb25-print-" + round + "-" + i, n.dataset.src, stage);
            copy.innerHTML = svg;
            n.setAttribute("data-print-copy", "");
          } catch (e) {}
        }
      } finally {
        stage.remove();
        const dark = document.documentElement.dataset.theme === "dark";
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      }
    };
  })();
</script>`;

/**
 * The diagram viewer's limits, as functions of plain numbers so the tests can
 * run them. diagramScale holds a zoom level between MIN and MAX. imageScale
 * does the same for an image, given the level `fits` that fits it to the
 * window, which is where it opens and as far out as it goes: there is nothing
 * to see in an image smaller than the window shows it. It zooms in to MAX, or
 * for a small drawing, which MAX would stop before it filled the window, to
 * MAX times the level that fits it. diagramBound places one
 * axis of the diagram, `size` long, in a stage `room` long: one that fits
 * stays wholly in view, at least ROOM from either side, and a bigger one can
 * be moved until its edge is ROOM inside the stage's, and no further, so the
 * reader is never left looking at empty space. imageBound does the same for
 * an image, more strictly: one that fits stays in the middle, and a bigger one
 * moves only until its edge meets the stage's.
 */
export const DIAGRAM_MODEL = `
  const MIN = 0.3;
  const MAX = 1.5;
  const ROOM = 32;
  function diagramScale(level) {
    return Math.min(MAX, Math.max(MIN, level));
  }
  function imageScale(level, fits) {
    return Math.min(Math.max(MAX, fits * MAX), Math.max(fits, level));
  }
  function diagramBound(at, size, room) {
    const far = room - size - ROOM;
    return Math.min(Math.max(ROOM, far), Math.max(Math.min(ROOM, far), at));
  }
  function imageBound(at, size, room) {
    if (size <= room) return (room - size) / 2;
    return Math.min(0, Math.max(room - size, at));
  }
`;

/**
 * The diagram viewer (DIAGRAM_VIEWER). Each diagram is put in a frame that
 * carries its expand button, outside the <pre> Mermaid draws into and empties
 * again on every theme change. Expanding copies the drawn SVG onto the stage
 * at its own size, then scales it to fit the window.
 *
 * A page's image opens the same way, clicked or with Enter (feedback #79): a
 * copy at its own size, which for an SVG that has none is the size it is
 * drawn at on the page. Not an image that is a link's, which opens where the
 * link leads, nor one in a dialog, such as the gallery's viewer.
 *
 * Dragging moves the view, and so does scrolling. Scrolling with Cmd/Ctrl
 * held zooms about the pointer, as does a pinch: Chromium sends one as a
 * scroll with Ctrl, Safari as gesture events. It is the one thing in
 * crescent's windows that zooms, as they never zoom the page itself
 * (feedback #70, #71). The buttons and + − 0 zoom about the middle, and 0 or
 * the level between them fits it again. Until the reader zooms or drags, the
 * diagram keeps fitting the window as it resizes.
 *
 * A diagram's zoom stays between 30% and 150% (feedback #37), and the view
 * stays on the diagram (DIAGRAM_MODEL): dragging past its edge stops there.
 * An image only zooms in from where it opens, and back out to there, where it
 * is fitted again. The viewer takes its shape there, rather than the
 * window's, so no empty bands frame it, and it stays put until zoomed in,
 * and then moves only within its own edges. It shows no level, which only
 * measures it against a size of its own that the reader never sees, nor the
 * hint, which tells mostly of what an image can't do; − and + are dimmed at
 * either end.
 */
const DIAGRAM_VIEWER_SCRIPT = `
(() => {
  const viewer = document.querySelector("[data-diagram-viewer]");
  const template = document.querySelector("[data-diagram-expand-template]");
  if (!viewer || !template || typeof viewer.showModal !== "function") return;
  const stage = viewer.querySelector("[data-diagram-stage]");
  const canvas = viewer.querySelector("[data-diagram-canvas]");
  const level = viewer.querySelector("[data-diagram-fit]");
  const zoomOut = viewer.querySelector('[data-diagram-zoom="out"]');
  const zoomIn = viewer.querySelector('[data-diagram-zoom="in"]');
  const article = document.querySelector("article.prose");
${DIAGRAM_MODEL}
  const STEP = 1.25;

  for (const pre of document.querySelectorAll("pre.mermaid")) {
    const frame = document.createElement("div");
    frame.className = "mermaid-frame";
    pre.before(frame);
    frame.append(pre, template.content.firstElementChild.cloneNode(true));
  }

  let scale = 1;
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  let fitted = true;
  // Whether what is open is an image, and the level that fits it to the window.
  let image = false;
  let fits = 1;

  function bounded(next) {
    return image ? imageScale(next, fits) : diagramScale(next);
  }
  function measure() {
    const box = stage.getBoundingClientRect();
    fits = Math.min((box.width - ROOM * 2) / width, (box.height - ROOM * 2) / height);
    return box;
  }
  // Size the viewer to an image fitted to the window, ROOM clear of each side.
  function hug() {
    viewer.style.width = "";
    viewer.style.height = "";
    const box = measure();
    const head = viewer.clientHeight - box.height;
    viewer.style.width = width * fits + ROOM * 2 + "px";
    viewer.style.height = height * fits + ROOM * 2 + head + "px";
  }
  function draw() {
    const bound = image ? imageBound : diagramBound;
    x = bound(x, width * scale, stage.clientWidth);
    y = bound(y, height * scale, stage.clientHeight);
    stage.classList.toggle("is-still", image && width * scale <= stage.clientWidth && height * scale <= stage.clientHeight);
    canvas.style.transform = "translate(" + x + "px, " + y + "px) scale(" + scale + ")";
    level.textContent = Math.round(scale * 100) + "%";
    // Dimmed rather than disabled, which would drop the focus out of the dialog.
    zoomOut.setAttribute("aria-disabled", String(bounded(scale / STEP) >= scale));
    zoomIn.setAttribute("aria-disabled", String(bounded(scale * STEP) <= scale));
  }
  function fit() {
    const box = measure();
    scale = bounded(fits);
    x = (box.width - width * scale) / 2;
    y = (box.height - height * scale) / 2;
    fitted = true;
    draw();
  }
  // Zoom to next, keeping the point (px, py) of the stage where it is.
  function zoom(next, px, py) {
    next = bounded(next);
    // Back out to where it opened, an image is fitted again, in the middle.
    if (image && next <= fits) return fit();
    x = px - (px - x) * (next / scale);
    y = py - (py - y) * (next / scale);
    scale = next;
    fitted = false;
    draw();
  }
  function zoomMiddle(factor) {
    zoom(scale * factor, stage.clientWidth / 2, stage.clientHeight / 2);
  }
  function pointOf(event) {
    if (typeof event.clientX !== "number") return [stage.clientWidth / 2, stage.clientHeight / 2];
    const box = stage.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  function show(copy, w, h, label, isImage) {
    if (viewer.open) return;
    width = w;
    height = h;
    image = isImage;
    viewer.classList.toggle("is-image", isImage);
    viewer.style.width = "";
    viewer.style.height = "";
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.replaceChildren(copy);
    viewer.setAttribute("aria-label", label);
    viewer.showModal();
    // Not its close button, which would wear a focus ring until clicked away.
    viewer.focus();
    if (isImage) hug();
    fit();
  }
  function openDiagram(frame) {
    const svg = frame.querySelector("pre.mermaid svg");
    if (!svg) return;
    const box = svg.viewBox && svg.viewBox.baseVal;
    const drawn = svg.getBoundingClientRect();
    const w = box && box.width ? box.width : drawn.width;
    const h = box && box.height ? box.height : drawn.height;
    if (!w || !h) return;
    const copy = svg.cloneNode(true);
    copy.setAttribute("width", String(w));
    copy.setAttribute("height", String(h));
    copy.style.maxWidth = "none";
    show(copy, w, h, "Diagram", false);
  }
  function openImage(img) {
    const copy = new Image();
    // Once the copy has loaded, so not an image that never does. It fills
    // the canvas, which show() sizes.
    copy.addEventListener("load", () => {
      // Its own size, in the shape the page draws it in.
      const w = img.naturalWidth || img.width;
      const h = img.width ? (w * img.height) / img.width : 0;
      if (w && h) show(copy, w, h, img.alt || "Image", true);
    });
    copy.alt = img.alt;
    copy.draggable = false;
    copy.src = img.currentSrc || img.src;
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-diagram-expand]") : null;
    const frame = button && button.closest(".mermaid-frame");
    if (frame) openDiagram(frame);
  });
  if (article) {
    for (const img of article.querySelectorAll("img")) {
      if (img.closest("a, dialog")) continue;
      img.setAttribute("data-image-open", "");
      img.tabIndex = 0;
    }
    const opens = (target) => target instanceof Element && target.matches("img[data-image-open]");
    article.addEventListener("click", (event) => {
      if (opens(event.target)) openImage(event.target);
    });
    article.addEventListener("keydown", (event) => {
      if ((event.key !== "Enter" && event.key !== " ") || !opens(event.target)) return;
      event.preventDefault();
      openImage(event.target);
    });
  }
  viewer.querySelector("[data-diagram-close]").addEventListener("click", () => viewer.close());
  // A click on the backdrop lands on the dialog itself.
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener("close", () => canvas.replaceChildren());
  level.addEventListener("click", fit);
  for (const button of viewer.querySelectorAll("[data-diagram-zoom]")) {
    const factor = button.getAttribute("data-diagram-zoom") === "in" ? STEP : 1 / STEP;
    button.addEventListener("click", () => zoomMiddle(factor));
  }
  viewer.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") zoomMiddle(STEP);
    else if (event.key === "-" || event.key === "_") zoomMiddle(1 / STEP);
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  });
  window.addEventListener("resize", () => {
    if (!viewer.open) return;
    if (image) hug();
    else measure();
    // An image the window has grown to show larger than this is fitted again.
    if (fitted || (image && scale <= fits)) fit();
    else draw();
  });

  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, dx: event.clientX - x, dy: event.clientY - y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    x = event.clientX - drag.dx;
    y = event.clientY - drag.dy;
    fitted = false;
    draw();
    // Held at an edge, the diagram follows the pointer back at once.
    drag.dx = event.clientX - x;
    drag.dy = event.clientY - y;
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  let pinching = false;
  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        if (pinching) return;
        // A wheel's notch is a hundred or so; a pinch's steps are a few.
        const delta = Math.max(-25, Math.min(25, event.deltaY * unit));
        const [px, py] = pointOf(event);
        zoom(scale * Math.exp(-delta * 0.01), px, py);
        return;
      }
      x -= event.deltaX * unit;
      y -= event.deltaY * unit;
      fitted = false;
      draw();
    },
    { passive: false }
  );
  let pinchFrom = 1;
  stage.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    pinching = true;
    pinchFrom = scale;
  });
  stage.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    const [px, py] = pointOf(event);
    zoom(pinchFrom * event.scale, px, py);
  });
  stage.addEventListener("gestureend", (event) => {
    event.preventDefault();
    pinching = false;
  });
})();
`;

/**
 * A diagram opened large (feedback #33). A busy Mermaid diagram shrinks to
 * the page's width until its labels can't be read, so each one gets a button
 * that opens it in a dialog nearly the size of the window, where it can be
 * dragged about and zoomed. A page's image opens in it too, when clicked
 * (feedback #79). It comes before MERMAID_SCRIPT, whose diagrams its script
 * (DIAGRAM_VIEWER_SCRIPT, above) frames first.
 */
export const DIAGRAM_VIEWER = `<template data-diagram-expand-template><button type="button" class="diagram-expand" data-diagram-expand aria-label="Expand diagram" title="Expand diagram"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg></button></template>
<dialog class="diagram-viewer" data-diagram-viewer tabindex="-1" aria-label="Diagram">
  <div class="diagram-viewer-head">
    <p class="diagram-viewer-hint">Drag to move it. Pinch, or scroll with &#8984;/Ctrl held, to zoom.</p>
    <div class="diagram-viewer-tools" role="group" aria-label="Zoom">
      <button type="button" class="diagram-tool" data-diagram-zoom="out" aria-label="Zoom out" title="Zoom out (&minus;)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3.5 8h9"/></svg></button>
      <button type="button" class="diagram-tool diagram-level" data-diagram-fit title="Fit to the window (0)">100%</button>
      <button type="button" class="diagram-tool" data-diagram-zoom="in" aria-label="Zoom in" title="Zoom in (+)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3.5 8h9M8 3.5v9"/></svg></button>
    </div>
    <button type="button" class="help-close" data-diagram-close aria-label="Close">&times;</button>
  </div>
  <div class="diagram-viewer-stage" data-diagram-stage><div class="diagram-viewer-canvas" data-diagram-canvas></div></div>
</dialog>
<script>${DIAGRAM_VIEWER_SCRIPT}</script>`;
