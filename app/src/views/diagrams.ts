/**
 * Mermaid diagrams: the script that draws them, and the viewer that opens one
 * large. DIAGRAM_MODEL is the viewer's zoom and bounds, which the tests run on
 * their own.
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
  })();
</script>`;

/**
 * The diagram viewer's limits, as functions of plain numbers so the tests can
 * run them. diagramScale holds a zoom level between MIN and MAX. diagramBound
 * places one axis of the diagram, `size` long, in a stage `room` long: one
 * that fits stays wholly in view, at least ROOM from either side, and a bigger
 * one can be moved until its edge is ROOM inside the stage's, and no further,
 * so the reader is never left looking at empty space.
 */
export const DIAGRAM_MODEL = `
  const MIN = 0.3;
  const MAX = 1.5;
  const ROOM = 32;
  function diagramScale(level) {
    return Math.min(MAX, Math.max(MIN, level));
  }
  function diagramBound(at, size, room) {
    const far = room - size - ROOM;
    return Math.min(Math.max(ROOM, far), Math.max(Math.min(ROOM, far), at));
  }
`;

/**
 * The diagram viewer (DIAGRAM_VIEWER). Each diagram is put in a frame that
 * carries its expand button, outside the <pre> Mermaid draws into and empties
 * again on every theme change. Expanding copies the drawn SVG onto the stage
 * at its own size, then scales it to fit the window.
 *
 * Dragging moves the view, and so does scrolling. Scrolling with Cmd/Ctrl
 * held zooms about the pointer, as does a pinch: Chromium sends one as a
 * scroll with Ctrl, Safari as gesture events, which also keep Crescent's
 * macOS window from zooming the whole page. The buttons and + − 0 zoom about
 * the middle, and 0 or the level between them fits it again. Until the reader
 * zooms or drags, the diagram keeps fitting the window as it resizes.
 *
 * Zoom stays between 30% and 150% (feedback #37), and the view stays on the
 * diagram (DIAGRAM_MODEL): dragging past its edge stops there.
 */
const DIAGRAM_VIEWER_SCRIPT = `
(() => {
  const viewer = document.querySelector("[data-diagram-viewer]");
  const template = document.querySelector("[data-diagram-expand-template]");
  if (!viewer || !template || typeof viewer.showModal !== "function") return;
  const stage = viewer.querySelector("[data-diagram-stage]");
  const canvas = viewer.querySelector("[data-diagram-canvas]");
  const level = viewer.querySelector("[data-diagram-fit]");
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

  function draw() {
    x = diagramBound(x, width * scale, stage.clientWidth);
    y = diagramBound(y, height * scale, stage.clientHeight);
    canvas.style.transform = "translate(" + x + "px, " + y + "px) scale(" + scale + ")";
    level.textContent = Math.round(scale * 100) + "%";
  }
  function fit() {
    const box = stage.getBoundingClientRect();
    const fits = Math.min((box.width - ROOM * 2) / width, (box.height - ROOM * 2) / height);
    scale = diagramScale(fits);
    x = (box.width - width * scale) / 2;
    y = (box.height - height * scale) / 2;
    fitted = true;
    draw();
  }
  // Zoom to next, keeping the point (px, py) of the stage where it is.
  function zoom(next, px, py) {
    next = diagramScale(next);
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

  function open(frame) {
    const svg = frame.querySelector("pre.mermaid svg");
    if (!svg) return;
    const box = svg.viewBox && svg.viewBox.baseVal;
    const drawn = svg.getBoundingClientRect();
    width = box && box.width ? box.width : drawn.width;
    height = box && box.height ? box.height : drawn.height;
    if (!width || !height) return;
    const copy = svg.cloneNode(true);
    copy.setAttribute("width", String(width));
    copy.setAttribute("height", String(height));
    copy.style.maxWidth = "none";
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.replaceChildren(copy);
    viewer.showModal();
    // Not its close button, which would wear a focus ring until clicked away.
    viewer.focus();
    fit();
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-diagram-expand]") : null;
    const frame = button && button.closest(".mermaid-frame");
    if (frame) open(frame);
  });
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
    if (fitted) fit();
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
 * dragged about and zoomed. It comes before MERMAID_SCRIPT, whose diagrams
 * its script (DIAGRAM_VIEWER_SCRIPT, above) frames first.
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
