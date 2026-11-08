import { LABEL_COLORS, type LabelColor } from "../labels.js";

/**
 * The viewer's one stylesheet, inlined into every page's <head> (head.ts), and
 * the label colours it carries for both themes.
 */

/**
 * Label swatches: chip background, chip ink, and a solid dot, per theme. The
 * light pairs are a pale tint under dark ink; the dark ones a deep tint under
 * pale ink — each clears 4.5:1, so a chip stays readable whichever theme is on.
 */
const LABEL_SWATCHES: Record<LabelColor, { light: [string, string, string]; dark: [string, string, string] }> = {
  gray: { light: ["#f3f4f6", "#374151", "#9ca3af"], dark: ["#30363d", "#d1d5db", "#8b949e"] },
  red: { light: ["#fee2e2", "#991b1b", "#ef4444"], dark: ["#4c1414", "#fecaca", "#f87171"] },
  orange: { light: ["#ffedd5", "#9a3412", "#f97316"], dark: ["#4a2410", "#fed7aa", "#fb923c"] },
  yellow: { light: ["#fef9c3", "#854d0e", "#eab308"], dark: ["#42340a", "#fef08a", "#facc15"] },
  green: { light: ["#dcfce7", "#166534", "#22c55e"], dark: ["#12361f", "#bbf7d0", "#4ade80"] },
  teal: { light: ["#ccfbf1", "#115e59", "#14b8a6"], dark: ["#123c38", "#99f6e4", "#2dd4bf"] },
  blue: { light: ["#dbeafe", "#1e40af", "#3b82f6"], dark: ["#172554", "#bfdbfe", "#60a5fa"] },
  purple: { light: ["#f3e8ff", "#6b21a8", "#a855f7"], dark: ["#3b1764", "#e9d5ff", "#c084fc"] },
  pink: { light: ["#fce7f3", "#9d174d", "#ec4899"], dark: ["#4a1230", "#fbcfe8", "#f472b6"] },
  brown: { light: ["#f1e7dc", "#5c3a1e", "#a0714a"], dark: ["#3a2817", "#ead7c3", "#c08a5b"] },
};

/** The `--label-<colour>-*` custom properties for one theme block. */
function labelTokens(theme: "light" | "dark"): string {
  return LABEL_COLORS.map((color) => {
    const [bg, fg, dot] = LABEL_SWATCHES[color][theme];
    return `--label-${color}-bg:${bg}; --label-${color}-fg:${fg}; --label-${color}-dot:${dot};`;
  }).join("\n  ");
}

/** Point a chip or dot's working colours at the swatch its data-label-color names. */
const LABEL_COLOR_RULES = LABEL_COLORS.map(
  (color) =>
    `[data-label-color="${color}"]{--lc-bg:var(--label-${color}-bg); --lc-fg:var(--label-${color}-fg); --lc-dot:var(--label-${color}-dot)}`
).join("\n");

/**
 * The dark theme's colours: what an explicit dark choice and the OS's dark
 * setting both turn on, and what the chat drawer always wears.
 */
const DARK_TOKENS = `
  color-scheme:dark;
  --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d;
  --accent:#4493f8; --on-accent:#0d1117; --sidebar:#0b0e14; --code-bg:#161b22;
  --fresh-glow:rgba(68,147,248,.6);
  --fg-secondary:#c9d1d9;
  --surface:#161b22; --surface-hover:#21262d; --surface-hover-2:#21262d;
  --tabs-bg:rgba(11,14,20,.84); --tab-hover-bg:rgba(240,246,252,.06); --tab-open-bg:#1c2129;
  --tab-open-shadow:0 0 0 1px rgba(240,246,252,.09), 0 1px 3px rgba(0,0,0,.45);
  --active-bg:#1f2d44; --selected-bg:#253a5e;
  --mark-bg:#5c4708; --mark-bg-strong:#7a5f0a; --mark-fg:#f5d67b;
  --note-bg:#134e4a; --note-bg-strong:#115e59; --note-fg:#99f6e4;
  --note-pin:#2dd4bf; --note-border:#0f766e;
  --task-bg:#4c1d95; --task-bg-strong:#5b21b6; --task-fg:#e9d5ff;
  --task-pin:#a855f7; --task-border:#6d28d9;
  --highlight-bg:#4a4d00; --highlight-bg-strong:#5f6300; --highlight-fg:#edf37a;
  --highlight-pin:#e2e800; --highlight-border:#6f7400;
  --agent-bg:#5c0f36; --agent-bg-strong:#7a1548; --agent-fg:#ffc9e6;
  --agent-pin:#ff2d87; --agent-border:#a31e5e;
  --focus-ring:#388bfd; --focus-ring-soft:#1f6feb;
  --sidebar-fade:rgba(11,14,20,0); --surface-hover-fade:rgba(33,38,45,0); --active-fade:rgba(31,45,68,0);
  --shadow-sm:0 2px 8px rgba(0,0,0,.5);
  --shadow-md:0 2px 8px rgba(0,0,0,.6);
  --shadow-lg:0 8px 30px rgba(0,0,0,.7);
  --shadow-card:0 1px 4px rgba(0,0,0,.5);
  --backdrop:rgba(1,4,9,.6);
  --diff-add-fg:#7ee787; --diff-add-bg:#12261a;
  --diff-del-fg:#ffa198; --diff-del-bg:#2d1213;
  --error-fg:#ff7b72; --error-bg:#2d1213; --error-border:#5c1a1a;
  --success-fg:#56d364; --success-bg:#12261a; --success-border:#1a4023;
  --warning-fg:#e3b341; --warning-bg:#2b2411; --warning-border:#4a3b12;
  --badge-web-fg:#a8c7fa; --badge-web-bg:#172554; --badge-web-border:#1e3a8a;
  --badge-mcp-fg:#d8b4fe; --badge-mcp-bg:#2e1065; --badge-mcp-border:#4c1d95;
  --hl-comment:#8b949e; --hl-keyword:#ff7b72; --hl-string:#a5d6ff;
  --hl-number:#79c0ff; --hl-title:#d2a8ff; --hl-attr:#ffa657;
  ${labelTokens("dark")}
`;

export const STYLES = `
:root{
  color-scheme:light;
  --bg:#fff; --fg:#1f2328; --muted:#6b7280; --line:#e5e7eb;
  --accent:#2563eb; --on-accent:#fff; --sidebar:#f7f8fa; --code-bg:#f6f8fa;
  /* The halo around a fresh page's dot in the sidebar: the accent, softened. */
  --fresh-glow:rgba(37,99,235,.55);
  --maxw:1216px;
  /* The tab strip's height: the corner's 34px tools with 12px above and below. */
  --tabs-h:58px;
  --fg-secondary:#374151;
  --surface:#fff; --surface-hover:#eef0f3; --surface-hover-2:#f7f8fa;
  --tabs-bg:rgba(247,248,250,.86); --tab-hover-bg:rgba(15,23,42,.05); --tab-open-bg:#fff;
  --tab-open-shadow:0 0 0 1px rgba(15,23,42,.07), 0 1px 2px rgba(15,23,42,.08), 0 2px 6px rgba(15,23,42,.04);
  --active-bg:#e7efff; --selected-bg:#dbeafe;
  --mark-bg:#fde68a; --mark-bg-strong:#fcd34d; --mark-fg:#713f12;
  /* A note is teal by default, which is what a remark keeps… */
  --note-bg:#ccfbf1; --note-bg-strong:#99f6e4; --note-fg:#115e59;
  --note-pin:#0d9488; --note-border:#5eead4;
  /* …a task is purple, because it asks for a change and should read as one… */
  --task-bg:#f3e8ff; --task-bg-strong:#e9d5ff; --task-fg:#6b21a8;
  --task-pin:#a855f7; --task-border:#d8b4fe;
  /* …and a highlight is the flat yellow of a highlighter pen, undiluted, because
     a washed-out yellow reads as stained paper rather than as a mark someone
     made. The ink is a dark olive of the same hue, not the brown of the amber
     search mark: the two now say "look here" in visibly different voices. */
  --highlight-bg:#fbff00; --highlight-bg-strong:#e9ed00; --highlight-fg:#3d4000;
  --highlight-pin:#9aa300; --highlight-border:#d8dd00;
  /* An agent note is pink: the one kind the reader did not write, so it wants a
     hue none of theirs uses. Magenta-leaning rather than rose, which keeps it
     off the pale red of the destructive buttons, and carrying more saturation
     than a task's tint, which is what keeps it off that tint's pale lavender —
     the two are hard to tell apart once both are washed out. The only kind
     whose pin needs no per-theme value: this reads on white and on black. */
  --agent-bg:#ffc9e6; --agent-bg-strong:#ffa8d6; --agent-fg:#6b0038;
  --agent-pin:#ff2d87; --agent-border:#ff8ec9;
  --focus-ring:#93c5fd; --focus-ring-soft:#bfdbfe;
  --sidebar-fade:rgba(247,248,250,0); --surface-hover-fade:rgba(238,240,243,0); --active-fade:rgba(231,239,255,0);
  --shadow-sm:0 2px 8px rgba(0,0,0,.08);
  --shadow-md:0 2px 8px rgba(0,0,0,.12);
  --shadow-lg:0 8px 30px rgba(0,0,0,.18);
  --shadow-card:0 1px 4px rgba(0,0,0,.06);
  --backdrop:rgba(15,23,42,.35);
  --diff-add-fg:#166534; --diff-add-bg:#dcfce7;
  --diff-del-fg:#991b1b; --diff-del-bg:#fee2e2;
  --error-fg:#991b1b; --error-bg:#fef2f2; --error-border:#fecaca;
  --success-fg:#166534; --success-bg:#f0fdf4; --success-border:#bbf7d0;
  --warning-fg:#92400e; --warning-bg:#fffbeb; --warning-border:#fde68a;
  --badge-web-fg:#1e40af; --badge-web-bg:#e7efff; --badge-web-border:#c7d7fe;
  --badge-mcp-fg:#6b21a8; --badge-mcp-bg:#f3e8ff; --badge-mcp-border:#e2ccf9;
  --hl-comment:#6a737d; --hl-keyword:#d73a49; --hl-string:#032f62;
  --hl-number:#005cc5; --hl-title:#6f42c1; --hl-attr:#e36209;
  ${labelTokens("light")}
}
:root[data-theme="dark"]{
  ${DARK_TOKENS}
}
/* No-JS fallback: honor the OS setting when no explicit choice was made. */
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]){
    ${DARK_TOKENS}
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--fg); background:var(--bg); display:flex; min-height:100vh;
}
a{color:var(--accent); text-decoration:none}
a:hover{text-decoration:underline}
.sidebar{
  width:300px; flex:0 0 300px; background:var(--sidebar);
  border-right:1px solid var(--line); padding:20px 16px; position:sticky; top:0;
  height:100vh; overflow:auto;
}
.brand{display:block; font-weight:700; font-size:15px; color:var(--fg);
  margin-bottom:16px; letter-spacing:.2px}
.brand:hover{text-decoration:none}
/* Back and Forward (PAGE_NAV) lead the sidebar's top row, beside the name. */
/* Its 30px buttons stand a little taller than the name, so the row is pulled
   up and left to leave the name and everything under it where they were. */
.sidebar-top{display:flex; align-items:center; gap:8px; margin:-3px 0 14px -6px}
.sidebar-top .brand{margin:0; min-width:0; overflow-wrap:anywhere}
html.has-tabs .sidebar-top{margin:0 0 16px}
html.has-tabs .sidebar-top .page-nav{display:none}
.sidebar-link{
  display:block; margin:0 0 14px; padding:4px 6px; border-radius:6px;
  color:var(--fg-secondary); font-size:14px; font-weight:600;
}
.sidebar-link:hover{background:var(--surface-hover); text-decoration:none}
.sidebar-link.active{background:var(--active-bg); color:var(--accent)}
/* "Create" disclosure: a sidebar link that reveals Page / Folder choices. */
.create-menu{margin:0 0 14px}
.create-menu>summary{margin:0; list-style:none; cursor:pointer}
.create-menu>summary::-webkit-details-marker{display:none}
.create-menu>summary::marker{content:""}
.create-menu-pop{
  margin:6px 0 0; padding:4px; display:flex; flex-direction:column;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-sm);
}
.create-menu-pop form{margin:0}
.create-menu-pop button{
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:6px 8px; border-radius:4px; color:var(--fg-secondary); font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit;
}
.create-menu-pop button:hover{background:var(--surface-hover)}
/* Inline name form (space rename) in the home grid's space ⋯ menu. */
.menu-name-form{display:flex; flex-direction:column; gap:4px; margin:0}
.menu-name-form input[type=text]{
  width:100%; box-sizing:border-box; padding:5px 7px; font-size:13px;
  color:var(--fg); background:var(--surface);
  border:1px solid var(--line); border-radius:4px;
}
/* Folder contents view */
.folder-tag{
  display:inline-block; padding:2px 8px; border-radius:999px;
  background:var(--surface-hover); color:var(--muted); font-size:12px; font-weight:600;
}
.folder-view{margin-top:8px}
.folder-create{display:flex; gap:10px; flex-wrap:wrap; align-items:flex-start; margin-bottom:18px}
.folder-create form{margin:0}
.folder-list{list-style:none; padding:0; margin:0; border-top:1px solid var(--line)}
.folder-list li{
  display:flex; align-items:center; gap:6px; padding:9px 4px;
  border-bottom:1px solid var(--line);
}
.folder-list li>a{font-weight:600}
.folder-empty{color:var(--muted); margin:18px 0}
/* Sidebar search: combobox + result panel, scoped to the current space. */
.sidebar-search{position:relative; margin:0 0 14px}
.sidebar-search-input{
  width:100%; padding:6px 8px; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--fg); font-size:14px; font-family:inherit;
}
.sidebar-search-input::placeholder{color:var(--muted)}
.sidebar-search-input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
/* Drop WebKit's native clear button so Esc is the one dismiss gesture. */
.sidebar-search-input::-webkit-search-cancel-button{-webkit-appearance:none; appearance:none}
/* The sidebar is the scroll container, so this panel is clipped to it; the input
   sits near the top of a 100vh column, which leaves room for the max-height. */
.sidebar-search-panel{
  position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:20;
  max-height:min(60vh,420px); overflow:auto; padding:4px;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-md);
}
.sidebar-search-item{
  display:block; padding:6px 8px; border-radius:4px; color:var(--fg-secondary);
  overflow-wrap:anywhere; cursor:pointer;
}
.sidebar-search-item:hover{background:var(--surface-hover); text-decoration:none}
.sidebar-search-item.is-active{background:var(--active-bg)}
.sidebar-search-item.is-active .sidebar-search-title{color:var(--accent)}
.sidebar-search-title{display:block; font-size:14px; font-weight:600; color:var(--fg)}
.sidebar-search-crumb{display:block; font-size:11px; color:var(--muted); margin-top:1px}
.sidebar-search-excerpt{
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
  font-size:12px; color:var(--muted); margin-top:3px; line-height:1.45;
}
/* Yellow highlight, but the browser default (black on bright yellow) is
   unreadable on a dark surface, so it rides tokens that flip with the theme. */
.sidebar-search-item mark{
  background:var(--mark-bg); color:var(--mark-fg); font-weight:600;
  border-radius:2px; padding:0 1px;
}
.sidebar-search-item.is-active mark{background:var(--mark-bg-strong)}
.sidebar-search-status{padding:6px 8px; font-size:12px; color:var(--muted)}
.sidebar-search-status[hidden]{display:none}
/* The label filter: a funnel inside the field, the picked labels as removable
   chips under it, and the picker in the flow below (the results panel floats
   beneath all three). */
.sidebar-search-field{position:relative}
.sidebar-search-field .sidebar-search-input{padding-right:40px}
.sidebar-search-filter{
  position:absolute; right:4px; top:50%; transform:translateY(-50%);
  display:inline-flex; align-items:center; gap:2px; height:24px; padding:0 5px;
  border:0; border-radius:4px; background:transparent; color:var(--muted); cursor:pointer;
}
.sidebar-search-filter[hidden]{display:none}
.sidebar-search-filter:hover,.sidebar-search-filter[aria-expanded="true"]{background:var(--surface-hover); color:var(--fg)}
.sidebar-search-filter.is-active{color:var(--accent)}
.sidebar-search-filter:focus-visible{outline:2px solid var(--focus-ring-soft)}
.sidebar-search-filter svg{display:block}
.sidebar-search-filter-count{font-size:11px; font-weight:700; line-height:1}
.sidebar-search-chips{display:flex; flex-wrap:wrap; gap:4px; margin-top:6px}
.sidebar-search-chips[hidden]{display:none}
.sidebar-search-chip{cursor:pointer; font-family:inherit}
.sidebar-search-chip:hover{border-color:var(--lc-dot)}
.sidebar-search-picker{
  display:flex; flex-direction:column; gap:1px; margin-top:6px; padding:4px;
  max-height:220px; overflow:auto;
  border:1px solid var(--line); border-radius:6px; background:var(--surface);
}
.sidebar-search-picker[hidden]{display:none}
.sidebar-search-label{
  display:flex; align-items:center; gap:6px; padding:3px 6px; border-radius:4px;
  cursor:pointer; font-size:13px;
}
.sidebar-search-label:hover{background:var(--surface-hover)}
.sidebar-search-label input{margin:0}
.sidebar-search-dots{display:inline-flex; align-items:center; gap:3px; margin-left:6px; vertical-align:middle}
.sidebar-search-more{
  display:block; margin-top:4px; padding:6px 8px; border-top:1px solid var(--line);
  font-size:12px; font-weight:600;
}
.sidebar-search-more[hidden]{display:none}
.move-error{
  margin:0 0 14px; padding:8px 10px; border:1px solid var(--error-border);
  border-radius:6px; background:var(--error-bg); color:var(--error-fg); font-size:13px;
}
/* The trailing padding is the overshoot room for a drag aimed at the end of the
   tree: it belongs to the nav, so MOVE_SCRIPT still sees the drag and reads it as
   "append to the space root" instead of letting the page slip past the last row. */
.tree{padding-bottom:24px}
.tree ul{list-style:none; margin:0; padding:0}
.tree .children{margin-left:12px; border-left:1px solid var(--line); padding-left:8px}
.tree a,.tree-label{display:block; padding:3px 6px; border-radius:6px; color:var(--fg-secondary); font-size:14px; overflow-wrap:anywhere; user-select:none}
.tree-label{color:var(--muted); font-weight:600}
.tree a:hover{background:var(--surface-hover); text-decoration:none}
.tree a.active{background:var(--active-bg); color:var(--accent); font-weight:600}
.tree a.selected{background:var(--selected-bg); box-shadow:inset 2px 0 0 var(--accent)}
.tree a[draggable="true"]{cursor:grab}
.tree a.drag-source{opacity:.55}
.tree a.drop-target-active,.space-current.drop-target-active{
  outline:2px solid var(--focus-ring); outline-offset:1px; background:var(--active-bg);
}
/* MOVE_SCRIPT flags the body while a page is in flight. Hinting the space name
   then recovers the affordance the always-visible dashed drop strip provided,
   without spending sidebar space on it the rest of the time. */
body.dragging-page .space-current{
  outline:1px dashed var(--line); outline-offset:2px; border-radius:4px;
}
/* Insertion points between rows. Zero height so the tree keeps its rhythm, and
   the indicator is drawn by a pseudo-element, so the pointer is never "over" a
   line — MOVE_SCRIPT picks one from the row edge under the cursor instead. The
   line inherits its group's indentation, which is what tells the reader which
   group it would drop into where two of them meet at the same height (the
   indicator moves between the two as the cursor crosses that boundary). */
/* pointer-events:none is load-bearing: the 2px indicator below straddles the
   boundary between two rows, and it would otherwise win the hit test over the
   very row edge the pointer is aiming at, swallowing the dragover. */
.tree .drop-line{position:relative; height:0; pointer-events:none}
.tree .drop-line::before{
  content:""; position:absolute; left:0; right:2px; top:-1px; height:2px;
  border-radius:2px; background:var(--accent); opacity:0;
}
.tree .drop-line.drop-line-active::before{opacity:1}
.tree-toggle{
  flex:0 0 auto; width:18px; height:24px; margin:0; padding:0; border:0;
  background:transparent; cursor:pointer; color:var(--muted);
  display:flex; align-items:center; justify-content:center; line-height:1;
}
.tree-toggle::before{content:"\\25B6"; font-size:9px; transition:transform .12s ease; transform:rotate(90deg)}
.tree li.collapsed > .tree-row .tree-toggle::before{transform:rotate(0deg)}
.tree-toggle:hover{color:var(--fg)}
.tree-toggle-spacer{flex:0 0 auto; width:18px}
.tree-folder-icon{flex:0 0 auto; width:14px; height:14px; margin-right:2px; color:var(--muted)}
/* Shares the marker column with .tree-toggle: the 2px side margins centre the
   14px glyph inside the same 18px box, so the dot and the caret sit on one
   vertical axis. Widths here and on .tree-toggle must stay in step. */
.tree-page-dot{flex:0 0 auto; width:14px; height:14px; margin:0 2px; color:var(--muted); opacity:.55}
.tree li.collapsed > .children{display:none}
.tree-row{position:relative; display:flex; align-items:center}
.tree-row>a{
  flex:1; min-width:0;
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
}
.tree-menu{position:absolute; right:0; top:0; flex:0 0 auto}
.tree-menu summary{
  list-style:none; cursor:pointer; user-select:none; opacity:0; pointer-events:none;
  display:flex; align-items:center; justify-content:flex-end;
  height:29px; padding:0 6px 0 24px; border-radius:6px;
  color:var(--muted); font-size:14px; line-height:1;
  background:linear-gradient(to right, var(--sidebar-fade) 0, var(--sidebar) 18px);
}
.tree-menu summary::-webkit-details-marker{display:none}
.tree-row:hover .tree-menu summary,.tree-row:focus-within .tree-menu summary,.tree-menu[open] summary{
  opacity:1; pointer-events:auto;
}
.tree-row:hover .tree-menu summary,.tree-row:focus-within .tree-menu summary{
  background:linear-gradient(to right, var(--surface-hover-fade) 0, var(--surface-hover) 18px);
}
.tree-row:has(>a.active) .tree-menu summary{
  background:linear-gradient(to right, var(--active-fade) 0, var(--active-bg) 18px);
}
.tree-menu-pop{
  position:absolute; right:0; top:100%; z-index:10; min-width:150px;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-sm); padding:4px; display:flex; flex-direction:column;
}
.tree-menu-pop form{margin:0}
.tree-menu-pop a,.tree-menu-pop button{
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:6px 8px; border-radius:4px; color:var(--fg-secondary); font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit;
}
.tree-menu-pop a:hover,.tree-menu-pop button:hover{background:var(--surface-hover); text-decoration:none}
.content{flex:1; padding:32px 40px; max-width:calc(var(--maxw) + 80px); width:100%}
/* "On this page". A third flex column so .content keeps its measure, hidden
   whenever the window is too narrow to afford it. min-width:0 and wrapping text
   are load-bearing: body is a flex row, so an unbreakable line in here would
   raise this column's min-content width and scroll the whole page sideways
   instead of being clipped. */
.toc{
  flex:0 0 232px; min-width:0; align-self:flex-start; position:sticky; top:0;
  max-height:100vh; overflow:auto;
  /* Top padding clears .session-corner, which floats at top:12px and is 34px
     tall — without it the rail's own heading sits under the Help button. */
  padding:60px 24px 32px 0;
}
.toc-head{
  color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.06em;
  text-transform:uppercase; margin-bottom:10px;
}
.toc-list{list-style:none; margin:0; padding:0; border-left:1px solid var(--line)}
.toc-item{margin:0}
.toc-item > a{
  display:block; padding:5px 10px; margin-left:-1px;
  border-left:2px solid transparent; overflow-wrap:anywhere;
  color:var(--muted); font-size:13px; line-height:1.4; text-decoration:none;
}
.toc-item[data-depth="1"] > a{padding-left:22px; font-size:12.5px}
.toc-item[data-depth="2"] > a{padding-left:34px; font-size:12.5px}
.toc-item > a:hover{color:var(--fg); text-decoration:none}
/* data-active marks the section and its parent; data-current only the one the
   reader is in. Both are data- attributes rather than the link's ARIA state,
   because this stylesheet ships on every page and a view with no open page is
   asserted to name nothing as current anywhere in its HTML. */
.toc-item[data-active] > a{color:var(--fg-secondary)}
.toc-item[data-current] > a{color:var(--accent); border-left-color:var(--accent)}
@media (max-width:1180px){.toc{display:none}}
.crumbs{color:var(--muted); font-size:13px; margin-bottom:18px}
.crumbs .sep{color:var(--line); margin:0 2px}
.page-head{display:flex; justify-content:space-between; gap:20px; align-items:flex-start}
.page-head h1{font-size:30px; line-height:1.2; margin:0 0 8px}
.meta{margin:0 0 24px}
.tags{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
.tag{background:var(--surface-hover); color:var(--fg-secondary); font-size:12px; padding:2px 8px; border-radius:999px}
.updated{color:var(--muted); font-size:12px}
.tags + .updated{margin-top:8px}
.actions{display:flex; gap:8px; flex:0 0 auto; align-items:center; flex-wrap:wrap}
.action-form{display:inline-flex; margin:0}
.confirm-actions{display:flex; gap:8px; align-items:center; margin-top:16px}
.session-actions{display:inline-flex; align-items:center; gap:8px; margin:0}
.session-user{color:var(--muted); font-size:13px}
.session-corner{position:fixed; top:12px; right:16px; z-index:50;
  display:flex; align-items:center; gap:8px}
/* The corner's two icon buttons share one box; only the theme toggle swaps its
   glyph, so the rules below it stay on that class alone. */
.theme-toggle,.chat-button,.gallery-button,.dash-button,.instructions-button,.feedback-button,.quit-button{
  display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:34px; height:34px; padding:0; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--fg-secondary); cursor:pointer;
}
.theme-toggle:hover,.chat-button:hover,.gallery-button:hover,.dash-button:hover,.instructions-button:hover,.feedback-button:hover,.quit-button:hover{background:var(--surface-hover-2); color:var(--fg)}
.chat-button svg,.gallery-button svg,.dash-button svg,.instructions-button svg,.feedback-button svg,.quit-button svg{display:block}
.chat-button[aria-expanded="true"]{background:var(--active-bg); border-color:var(--accent); color:var(--accent)}
.theme-toggle .theme-icon{display:block}
.theme-toggle .icon-moon{display:none}
:root[data-theme="dark"] .theme-toggle .icon-sun{display:none}
:root[data-theme="dark"] .theme-toggle .icon-moon{display:block}
/* The tabs (tabStrip): a bar along the top of the window, drawn only while two
   or more are open, when TABS_SCRIPT puts has-tabs on the root. The corner's
   tools float over its right end, which --tabs-reserve (their width) keeps
   clear of tabs. The strip is fixed and out of body's flex row, so its
   nowrap titles cannot widen the page; the page scrolls on under it, frosted. */
.tab-strip{
  position:fixed; top:0; left:0; right:0; z-index:45; height:var(--tabs-h);
  display:flex; align-items:center;
  padding:0 calc(var(--tabs-reserve, 0px) + 28px) 0 12px;
  background:var(--tabs-bg); border-bottom:1px solid var(--line);
  -webkit-backdrop-filter:saturate(180%) blur(14px); backdrop-filter:saturate(180%) blur(14px);
}
.tab-strip[hidden]{display:none}
/* Padded so that the scrolling box does not clip the open tab's shadow. */
.tab-list{
  position:relative; flex:1; min-width:0; display:flex; align-items:center; gap:3px;
  padding:4px 2px; overflow-x:auto; scrollbar-width:none;
}
.tab-list::-webkit-scrollbar{display:none}
/* Close other tabs: an icon button, set off from the tabs by a hairline. */
.tabs-close-others{
  position:relative; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center;
  width:30px; height:30px; margin-right:12px; padding:0; border:0; border-radius:8px;
  background:transparent; color:var(--muted); cursor:pointer;
  transition:background-color .15s ease, color .15s ease;
}
.tabs-close-others::after{
  content:""; position:absolute; right:-7px; top:7px; bottom:7px; width:1px; background:var(--line);
}
.tabs-close-others:hover{background:var(--tab-hover-bg); color:var(--fg)}
.tabs-close-others:focus-visible{outline:2px solid var(--focus-ring); outline-offset:1px}
.tabs-close-others svg{display:block}
/* Back and Forward (PAGE_NAV): icon buttons like Close other tabs, before it. */
.page-nav{flex:0 0 auto; display:flex; align-items:center; gap:2px}
.tab-strip .page-nav{margin-right:4px}
.page-nav-button{
  display:inline-flex; align-items:center; justify-content:center;
  width:30px; height:30px; padding:0; border:0; border-radius:8px;
  background:transparent; color:var(--muted); cursor:pointer;
  transition:background-color .15s ease, color .15s ease;
}
.page-nav-button:hover:not(:disabled){background:var(--tab-hover-bg); color:var(--fg)}
.page-nav-button:focus-visible{outline:2px solid var(--focus-ring); outline-offset:1px}
.page-nav-button:disabled,html.kb-no-back [data-page-back],html.kb-no-forward [data-page-forward]{opacity:.35; cursor:default}
.page-nav-button svg{display:block}
.tab{
  position:relative; flex:0 1 200px; min-width:88px; height:32px;
  display:flex; align-items:center; gap:7px; padding:0 5px 0 11px;
  border-radius:8px; color:var(--muted); cursor:pointer;
  transition:background-color .15s ease, color .15s ease, box-shadow .15s ease;
}
/* Hairlines between tabs, as in a browser. They give way beside the open tab
   and the one under the pointer, which have a shape of their own. */
.tab + .tab::before{
  content:""; position:absolute; left:-2px; top:9px; bottom:9px; width:1px;
  background:var(--line); transition:opacity .15s ease;
}
.tab:hover::before,.tab:hover + .tab::before,.tab.is-open::before,.tab.is-open + .tab::before{opacity:0}
.tab:hover{background:var(--tab-hover-bg); color:var(--fg-secondary)}
.tab.is-open{background:var(--tab-open-bg); color:var(--fg); box-shadow:var(--tab-open-shadow)}
.tab:has(.tab-link:focus-visible){box-shadow:0 0 0 2px var(--focus-ring)}
.tab-icon{flex:0 0 auto; display:block; opacity:.7}
.tab.is-open .tab-icon{color:var(--accent); opacity:1}
/* A long title fades out at the end rather than stopping on an ellipsis. */
.tab-link{
  flex:1; min-width:0; color:inherit; font-size:12.5px; font-weight:500; line-height:32px;
  white-space:nowrap; overflow:hidden;
  -webkit-mask-image:linear-gradient(to right, #000 calc(100% - 16px), transparent);
  mask-image:linear-gradient(to right, #000 calc(100% - 16px), transparent);
}
.tab-link:hover{text-decoration:none}
.tab-link:focus-visible{outline:none}
.tab-close{
  flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center;
  width:20px; height:20px; padding:0; border:0; border-radius:6px;
  background:transparent; color:inherit; cursor:pointer; opacity:0;
  transition:opacity .12s ease, background-color .12s ease;
}
.tab-close svg{display:block}
.tab:hover .tab-close,.tab.is-open .tab-close,.tab-close:focus-visible{opacity:.6}
.tab-close:hover{opacity:1; background:color-mix(in srgb, currentColor 14%, transparent)}
/* The strip slides in and out, the page moving with it (tabs-animate, for
   that one change only); a new tab fades in once its page has loaded
   (tabs-loaded); a closed one folds away. */
@keyframes tabs-in{from{transform:translateY(-100%)}}
@keyframes tabs-out{to{transform:translateY(-100%)}}
@keyframes tab-in{from{opacity:0; transform:translateY(-3px) scale(.97)}}
@keyframes tab-out{to{opacity:0; flex-basis:0; min-width:0; padding:0}}
.tab-strip.is-entering{animation:tabs-in .3s cubic-bezier(.2,.8,.2,1)}
.tab-strip.is-leaving{animation:tabs-out .3s cubic-bezier(.2,.8,.2,1) forwards}
.tab.is-new{animation:tab-in .24s cubic-bezier(.2,.8,.2,1) both; animation-play-state:paused}
html.tabs-loaded .tab.is-new{animation-play-state:running}
.tab.is-closing{overflow:hidden; pointer-events:none; animation:tab-out .16s ease-in forwards}
html.tabs-animate body{transition:padding-top .3s cubic-bezier(.2,.8,.2,1)}
html.tabs-animate .toc{transition:top .3s cubic-bezier(.2,.8,.2,1), max-height .3s cubic-bezier(.2,.8,.2,1), padding-top .3s cubic-bezier(.2,.8,.2,1)}
html.has-tabs{scroll-padding-top:var(--tabs-h)}
html.has-tabs body{padding-top:var(--tabs-h)}
html.has-tabs .toc{top:var(--tabs-h); max-height:calc(100vh - var(--tabs-h)); padding-top:32px}
@media (min-width:781px){
  html.has-tabs .sidebar{top:var(--tabs-h); height:calc(100vh - var(--tabs-h))}
  html.tabs-animate .sidebar{transition:top .3s cubic-bezier(.2,.8,.2,1), height .3s cubic-bezier(.2,.8,.2,1)}
}
/* Too narrow for tabs beside the tools: the tabs take a row under them. */
@media (max-width:780px){
  html.has-tabs{--tabs-h:104px}
  .tab-strip{align-items:flex-end; padding:0 12px 10px}
}
/* A page opened from another fades in (TABS_SCRIPT). One put back where it
   was read stays out of sight until it is there, and fades in then; should
   the script never get that far, it shows anyway. */
@keyframes kb-show{to{visibility:visible}}
@keyframes kb-fade-in{from{opacity:0}}
html.kb-placing main,html.kb-placing .toc{visibility:hidden; animation:kb-show 0s 2s forwards}
html.kb-arrived main,html.kb-arrived .toc{animation:kb-fade-in .14s ease-out}
@media (prefers-reduced-motion:reduce){
  .tab-strip.is-entering,.tab-strip.is-leaving,.tab.is-new,.tab.is-closing,
  html.kb-arrived main,html.kb-arrived .toc{animation:none}
  html.tabs-animate body,html.tabs-animate .toc,html.tabs-animate .sidebar{transition:none}
}
.help-dialog{
  width:min(520px,92vw); border:1px solid var(--line); border-radius:10px;
  padding:0; color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.help-dialog::backdrop{background:var(--backdrop)}
/* An opened dialog holds the focus itself (HELP_SCRIPT, GALLERY_SCRIPT), so
   Tab and Esc work at once; the frame needs no ring for it. */
.help-dialog:focus,.gallery-viewer:focus{outline:none}
/* The feedback dialog draws itself in a shadow root (FEEDBACK_SCRIPT); these
   hand it KB25's colours, which follow the theme like everything else. */
:root{
  --feedback-accent:var(--accent); --feedback-on-accent:var(--on-accent); --feedback-fg:var(--fg);
  --feedback-muted:var(--muted); --feedback-surface:var(--surface); --feedback-field:var(--bg);
  --feedback-line:var(--line); --feedback-code:var(--code-bg); --feedback-hover:var(--surface-hover-2);
  --feedback-error:var(--error-fg);
}
/* Bottom-right on every signed-in page, out of the way of the corner tools
   and the page; hidden unless an installed copy has an update to offer. The
   copy-link toast (bottom-center, z-index 60) still shows above it. */
.update-card{
  position:fixed; bottom:16px; right:16px; z-index:50; width:min(320px, calc(100vw - 32px));
  padding:14px 16px; border:1px solid var(--line); border-radius:10px;
  background:var(--surface); color:var(--fg); box-shadow:var(--shadow-lg);
}
.update-title{margin:0; font-size:14px; font-weight:600}
.update-text{margin:6px 0 0; color:var(--muted); font-size:13px; overflow-wrap:anywhere}
/* The developers' message after an update: what the card is there to say. */
.update-message{color:var(--fg); white-space:pre-line}
.update-notes{display:inline-block; margin-top:4px; font-size:13px}
.update-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:12px}
.help-head{
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  margin:0; padding:16px 20px; border-bottom:1px solid var(--line);
}
.help-head h2{font-size:18px; line-height:1.2; margin:0}
.help-close{
  border:0; background:transparent; cursor:pointer; color:var(--muted);
  font-size:22px; line-height:1; padding:0 4px;
}
.help-close:hover{color:var(--fg)}
.help-section{padding:16px 20px 0}
.help-section:last-child{padding-bottom:20px}
.help-section .quit-error{margin-top:8px; color:var(--error-fg)}
.quit-actions{display:flex; justify-content:flex-end; gap:8px; margin:0; padding:16px 20px 20px}
.help-section h3{font-size:14px; margin:0 0 8px}
.help-section p{margin:0; color:var(--fg-secondary); font-size:14px; line-height:1.6}
.help-keys{display:grid; grid-template-columns:auto 1fr; gap:8px 16px; margin:0}
.help-keys dt{display:flex; align-items:center; gap:4px}
.help-keys dd{margin:0; color:var(--fg-secondary); font-size:14px}
.help-keys kbd{
  display:inline-block; border:1px solid var(--line); border-bottom-width:2px;
  border-radius:5px; background:var(--code-bg); padding:1px 6px;
  font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.button{
  display:inline-flex; align-items:center; justify-content:center; min-height:34px;
  border:1px solid var(--line); border-radius:6px; padding:5px 12px;
  font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  cursor:pointer;
}
.button:hover{text-decoration:none}
.button.primary{background:var(--accent); border-color:var(--accent); color:var(--on-accent)}
.button.secondary{background:var(--surface); color:var(--fg-secondary)}
.button.secondary:hover{background:var(--surface-hover-2)}
.button.danger{background:var(--surface); border-color:var(--error-border); color:var(--error-fg)}
.button.danger:hover{background:var(--error-bg)}
/* Transient feedback after a "Copy link" action: the clicked control tints, and
   the toast below carries the wording. */
.button.copied{background:var(--success-bg); border-color:var(--success-border); color:var(--success-fg)}
.button.copy-failed{background:var(--error-bg); border-color:var(--error-border); color:var(--error-fg)}
.tree-menu-pop button.copied{color:var(--success-fg)}
.tree-menu-pop button.copy-failed{color:var(--error-fg)}
.tree a.copied{background:var(--success-bg); color:var(--success-fg)}
.tree a.copy-failed{background:var(--error-bg); color:var(--error-fg)}
/* Find on the page (FIND_BAR): under the corner's tools, below the tabs and
   beside the chat the way the tools are. While it is open the rail starts
   lower, so the bar covers none of the entries it finds. */
.find-bar{
  position:fixed; top:56px; right:16px; z-index:50;
  display:flex; align-items:center; gap:2px;
  width:min(360px,calc(100vw - 32px)); padding:4px 4px 4px 10px;
  background:var(--surface); border:1px solid var(--line); border-radius:8px;
  box-shadow:var(--shadow-md);
}
.find-bar[hidden]{display:none}
.find-bar:focus-within{border-color:var(--focus-ring); outline:2px solid var(--focus-ring-soft)}
.find-input{
  flex:1; min-width:0; padding:4px 0; border:0; outline:0; background:transparent;
  color:var(--fg); font:inherit; font-size:14px;
}
.find-input::placeholder{color:var(--muted)}
.find-count{flex:0 0 auto; padding:0 6px; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; white-space:nowrap}
.find-bar.is-missing .find-count{color:var(--error-fg)}
.find-step{
  display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:28px; height:28px; padding:0; border:0; border-radius:6px;
  background:transparent; color:var(--fg-secondary); cursor:pointer;
}
.find-step:hover{background:var(--surface-hover); color:var(--fg)}
.find-step:disabled{opacity:.4; cursor:default; background:transparent; color:var(--fg-secondary)}
.find-step svg{display:block}
html.has-tabs .find-bar{top:calc(var(--tabs-h) + 8px)}
body.chat-open .find-bar{right:416px}
@media (max-width:900px){body.chat-open .find-bar{right:16px}}
html.has-find .toc{padding-top:108px}
html.has-find.has-tabs .toc{padding-top:58px}
/* The matches, and the one in hand. Plain colours rather than the theme's
   tokens: not every engine resolves var() inside a highlight. */
::highlight(kb25-find){background-color:#fde68a; color:#713f12}
::highlight(kb25-find-current){background-color:#fb923c; color:#1f2328}
:root[data-theme="dark"] ::highlight(kb25-find){background-color:#5c4708; color:#f5d67b}
:root[data-theme="dark"] ::highlight(kb25-find-current){background-color:#f59e0b; color:#0d1117}
/* Toast: rises from below the bottom edge, holds a couple of seconds, sinks back.
   Created by COPY_LINK_SCRIPT; the class names stay generic so another action can
   reuse it. z-index clears .session-corner (50); a <dialog> still wins via the
   top layer, which is correct — a modal should cover it. */
.toast{
  position:fixed; left:50%; bottom:24px; z-index:60;
  max-width:min(420px,calc(100vw - 32px)); padding:10px 16px;
  border:1px solid var(--success-border); border-radius:8px;
  background:var(--success-bg); color:var(--success-fg);
  font-size:14px; font-weight:600; text-align:center;
  box-shadow:var(--shadow-md); pointer-events:none;
  opacity:0; transform:translate(-50%,calc(100% + 24px));
  transition:transform .28s ease, opacity .28s ease;
}
.toast.is-visible{opacity:1; transform:translate(-50%,0)}
.toast.is-error{border-color:var(--error-border); background:var(--error-bg); color:var(--error-fg)}
@media(prefers-reduced-motion:reduce){
  /* No travel when less motion was asked for — fade in place instead. */
  .toast{transform:translate(-50%,0); transition:opacity .12s ease}
}
.prose{max-width:var(--maxw)}
.prose h1,.prose h2,.prose h3{line-height:1.25; margin-top:1.6em}
.prose h2{font-size:22px; border-bottom:1px solid var(--line); padding-bottom:.2em}
.prose h3{font-size:18px}
/* Section links. Nothing is sticky above the content, so a #anchor already
   lands at the top of the viewport; the margin is breathing room and clears the
   floating .session-corner. The affordance sits after the heading text because
   the left gutter belongs to .note-pin. */
.prose :is(h1,h2,h3,h4,h5,h6){scroll-margin-top:28px}
.section-link{
  margin-left:.4em; color:var(--muted); text-decoration:none; font-weight:400;
  opacity:0; transition:opacity .12s ease; cursor:pointer;
}
/* Generated, so the glyph stays out of the heading's textContent — see the
   heading_close renderer for why that matters. */
.section-link::before{content:"#"}
@media (prefers-reduced-motion:reduce){.section-link{transition:none}}
.prose :is(h1,h2,h3,h4,h5,h6):hover .section-link,
.section-link:focus-visible{opacity:1}
.section-link:hover{color:var(--accent)}
.section-link.copied{opacity:1; color:var(--success-fg)}
.section-link.copy-failed{opacity:1; color:var(--error-fg)}
@media (hover:none){.section-link{opacity:.5}}
.prose p,.prose ul,.prose ol{margin:.7em 0}
.prose code{background:var(--code-bg); padding:.15em .35em; border-radius:4px;
  font-size:.88em; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.prose pre{background:var(--code-bg); padding:14px 16px; border-radius:8px;
  overflow:auto; border:1px solid var(--line)}
.prose pre code{background:none; padding:0}
.prose pre.mermaid{background:none; border:none; padding:0; text-align:center; overflow:auto}
.prose pre.mermaid:not([data-processed]){visibility:hidden}
/* A diagram and the button that opens it large (DIAGRAM_VIEWER), shown on
   hover, or always where nothing hovers; not before the diagram is drawn. */
.mermaid-frame{position:relative}
.diagram-expand{
  position:absolute; top:6px; right:6px; z-index:1;
  display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; padding:0;
  border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--muted);
  cursor:pointer; opacity:0; transition:opacity .12s ease;
}
.mermaid-frame:hover .diagram-expand,.diagram-expand:focus-visible{opacity:1}
.diagram-expand:hover{background:var(--surface-hover-2); color:var(--fg)}
.diagram-expand:focus-visible{outline:2px solid var(--focus-ring); outline-offset:2px}
.mermaid-frame > pre.mermaid:not([data-processed]) + .diagram-expand{display:none}
@media (hover:none){.diagram-expand{opacity:1}}
.diagram-viewer{
  width:calc(100vw - 32px); height:calc(100vh - 32px); max-width:none; max-height:none;
  padding:0; overflow:hidden; border:1px solid var(--line); border-radius:10px;
  color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.diagram-viewer[open]{display:flex; flex-direction:column}
.diagram-viewer::backdrop{background:var(--backdrop)}
.diagram-viewer:focus{outline:none}
.diagram-viewer-head{
  display:flex; align-items:center; gap:12px; padding:10px 14px 10px 20px; border-bottom:1px solid var(--line);
}
.diagram-viewer-hint{flex:1; min-width:0; margin:0; color:var(--muted); font-size:13px}
.diagram-viewer-tools{display:flex; align-items:center; gap:4px}
.diagram-tool{
  display:inline-flex; align-items:center; justify-content:center; min-width:32px; height:32px; padding:0 8px;
  border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--fg-secondary);
  font-family:inherit; font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; cursor:pointer;
}
.diagram-tool:hover{background:var(--surface-hover-2); color:var(--fg)}
.diagram-level{min-width:64px}
.diagram-viewer-stage{
  position:relative; flex:1; min-height:0; overflow:hidden; background:var(--bg);
  cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none;
}
.diagram-viewer-stage.is-dragging{cursor:grabbing}
.diagram-viewer-canvas{position:absolute; left:0; top:0; transform-origin:0 0}
.diagram-viewer-canvas svg{display:block}
/* A formula wider than the column scrolls on its own instead of the page. */
.prose .katex-display{overflow-x:auto; overflow-y:hidden; padding:.2em 0}
.prose .math-block{margin:.7em 0}
.prose .math-block .katex-display{margin:0}
.prose blockquote{margin:1em 0; padding:.4em 1em; color:var(--muted);
  border-left:3px solid var(--line)}
.prose table{border-collapse:collapse; width:100%}
.prose th,.prose td{border:1px solid var(--line); padding:6px 10px; text-align:left}
/* height:auto keeps a width-sized image undistorted when max-width shrinks it. */
.prose img{max-width:100%; height:auto}
/* Diagrams are usually drawn in black on a transparent background meant for a
   white page, so in dark mode their lines and labels vanish into --bg. Back
   every image with a light panel there, dimmed slightly to cut the glare. */
:root[data-theme="dark"] .prose img{background:#f0f3f6; padding:8px; border-radius:6px; filter:brightness(.9)}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]) .prose img{background:#f0f3f6; padding:8px; border-radius:6px; filter:brightness(.9)}
}
.wikilink{border-bottom:1px dotted var(--accent)}
/* Inline notes.
   Only annotated blocks become positioning contexts, so an unannotated page
   lays out exactly as it did before this feature existed. The pin sits in the
   left padding of .content (40px, 20px on mobile) — hence the two offsets. */
.prose [data-kb25-notes]{position:relative}
/* A task, a highlight and an agent note each carry their own palette on the
   element, so every rule below stays kind-agnostic and a remark keeps the teal it
   always had. Leaf elements only: swapping the tokens on a container would leak
   into the Remark button of the kind switch nested inside a card. An agent note
   has no .note-kind-option, because the switch never offers it. */
.note-mark.is-task,.note-pin.is-task,.note-kind.is-task,.note-kind-option.is-task{
  --note-bg:var(--task-bg); --note-bg-strong:var(--task-bg-strong);
  --note-fg:var(--task-fg); --note-pin:var(--task-pin); --note-border:var(--task-border);
}
.note-mark.is-highlight,.note-pin.is-highlight,.note-kind.is-highlight,
.note-kind-option.is-highlight{
  --note-bg:var(--highlight-bg); --note-bg-strong:var(--highlight-bg-strong);
  --note-fg:var(--highlight-fg); --note-pin:var(--highlight-pin);
  --note-border:var(--highlight-border);
}
.note-mark.is-agent,.note-pin.is-agent,.note-kind.is-agent{
  --note-bg:var(--agent-bg); --note-bg-strong:var(--agent-bg-strong);
  --note-fg:var(--agent-fg); --note-pin:var(--agent-pin); --note-border:var(--agent-border);
}
.prose mark.note-mark{
  background:var(--note-bg); color:var(--note-fg);
  border-radius:2px; padding:0 .05em; cursor:pointer;
}
.prose mark.note-mark.is-active{background:var(--note-bg-strong)}
.prose mark.note-mark.is-highlight{
  background:transparent; color:inherit; border-radius:0; padding:0;
  text-decoration-line:underline; text-decoration-color:var(--note-pin);
  text-decoration-thickness:.14em; text-underline-offset:.12em;
}
.prose mark.note-mark.is-highlight.is-active{
  background:transparent; text-decoration-thickness:.22em;
}
.note-pin{
  position:absolute; left:-22px; top:.3em; width:14px; height:14px; padding:0;
  border:2px solid var(--note-pin); border-radius:50%; background:var(--note-pin);
  cursor:pointer; line-height:0;
}
.note-pin.is-remark{background:transparent}
.note-pin:hover{box-shadow:0 0 0 3px var(--note-bg)}
.note-popover,.note-composer{
  position:fixed; z-index:70; width:min(320px,calc(100vw - 24px));
  padding:12px 14px; border:1px solid var(--note-border); border-radius:8px;
  background:var(--surface); color:var(--fg); box-shadow:var(--shadow-lg);
  display:flex; flex-direction:column; gap:10px;
}
.note-card{display:flex; flex-direction:column; gap:6px}
.note-card + .note-card{border-top:1px solid var(--line); padding-top:10px}
/* Below the cards, what takes down every agent note on the page at once. */
.note-popover-foot{border-top:1px solid var(--line); padding-top:10px}
.note-card-head{display:flex; align-items:center; gap:8px}
.note-kind{
  font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
  padding:1px 7px; border-radius:999px;
  background:var(--note-bg); color:var(--note-fg); border:1px solid var(--note-border);
}
.note-kind.is-remark{background:var(--surface-hover); color:var(--muted); border-color:var(--line)}
.note-when{color:var(--muted); font-size:12px}
.note-quote{
  color:var(--muted); font-size:13px; font-style:italic;
  border-left:2px solid var(--note-border); padding-left:8px;
}
/* pre-wrap so a multi-line note keeps the shape its author gave it. */
.note-text{font-size:14px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere}
/* A link in a note is underlined the way a [[wiki-link]] is in the prose: in a
   card this small, colour alone is thin evidence that a phrase is clickable. */
.note-text a{border-bottom:1px dotted var(--accent)}
.note-input{
  width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:6px;
  background:var(--bg); color:var(--fg); font:inherit; font-size:14px; resize:vertical;
}
.note-composer-actions,.note-card-actions{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
/* Three kinds alongside Cancel and Save do not fit across a 320px panel, and a
   clipped third kind is one nobody finds — so the switch takes the full width of
   its own row and splits it evenly. Reading a note shows no switch, so the
   Edit/Resolve row below is unaffected. */
.note-kinds{display:flex; flex:1 0 100%; border:1px solid var(--line); border-radius:6px; overflow:hidden}
.note-kind-option{
  flex:1; padding:4px 8px; text-align:center;
  border:0; background:var(--surface); color:var(--muted);
  font:inherit; font-size:13px; cursor:pointer;
}
.note-kind-option.is-selected{background:var(--note-bg); color:var(--note-fg); font-weight:600}
.note-add{
  position:fixed; z-index:70; padding:5px 12px;
  border:1px solid var(--note-border); border-radius:999px;
  background:var(--note-pin); color:#fff;
  font:inherit; font-size:13px; font-weight:600; cursor:pointer;
  box-shadow:var(--shadow-md);
}
/* Diff / history viewer */
.button.disabled{color:var(--muted); background:var(--surface); cursor:default; opacity:.55}
.button.disabled:hover{background:var(--surface)}
.diff-title{font-weight:400; color:var(--muted)}
.revbar{
  display:flex; flex-wrap:wrap; align-items:center; gap:12px; justify-content:space-between;
  padding:10px 14px; margin:0 0 16px; border:1px solid var(--line); border-radius:8px;
  background:var(--sidebar);
}
.revbar-meta{display:flex; flex-wrap:wrap; align-items:center; gap:10px; min-width:0}
.revbar-nav{display:flex; gap:8px; flex:0 0 auto}
.diff-pos{font-weight:700}
.diff-date{color:var(--muted); font-variant-numeric:tabular-nums}
.diff-subject{
  color:var(--muted); font-size:13px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.badge{
  display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:700;
  border:1px solid transparent;
}
.badge-web{color:var(--badge-web-fg); background:var(--badge-web-bg); border-color:var(--badge-web-border)}
.badge-mcp{color:var(--badge-mcp-fg); background:var(--badge-mcp-bg); border-color:var(--badge-mcp-border)}
.diffview{
  max-width:var(--maxw); white-space:pre-wrap; word-wrap:break-word;
  background:var(--code-bg); border:1px solid var(--line); border-radius:8px;
  padding:14px 16px; overflow:auto;
  font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.diffview ins.diff-add{
  text-decoration:none; color:var(--diff-add-fg); background:var(--diff-add-bg);
  border-radius:3px; padding:0 1px;
}
.diffview del.diff-del{
  text-decoration:line-through; color:var(--diff-del-fg); background:var(--diff-del-bg);
  border-radius:3px; padding:0 1px;
}
.diff-sep{display:block; color:var(--muted); text-align:center; user-select:none; margin:.4em 0}
.editor-content{max-width:none}
.editor{max-width:1100px}
.editor-label{display:block; font-size:13px; font-weight:700; margin-bottom:8px}
.editor textarea{
  display:block; width:100%; min-height:62vh; resize:vertical;
  border:1px solid var(--line); border-radius:8px; padding:14px 16px;
  color:var(--fg); background:var(--surface);
  font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.editor textarea:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.slug-row{display:flex; align-items:center; gap:6px; margin-bottom:6px}
.slug-prefix{color:var(--muted); font:13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.slug-row input{
  flex:1; border:1px solid var(--line); border-radius:8px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.slug-row input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.slug-hint{color:var(--muted); font-size:12px; margin:0 0 16px}
.form-actions{display:flex; gap:8px; align-items:center; margin-top:12px}
.notice{
  max-width:1100px; margin:0 0 16px; border:1px solid var(--line);
  border-radius:8px; padding:10px 12px; font-size:14px;
}
.notice.error{border-color:var(--error-border); background:var(--error-bg); color:var(--error-fg)}
.notice.success{border-color:var(--success-border); background:var(--success-bg); color:var(--success-fg)}
.notice.warning,.notice.archived{border-color:var(--warning-border); background:var(--warning-bg); color:var(--warning-fg)}
.path-label{color:var(--muted); font-size:12px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.login-page{
  min-height:100vh; align-items:center; justify-content:center; padding:24px;
  background:var(--sidebar);
}
.login-panel{
  width:100%; max-width:360px; border:1px solid var(--line); border-radius:8px;
  background:var(--surface); padding:24px;
}
.login-panel h1{font-size:24px; line-height:1.2; margin:0 0 4px}
.login-subtitle{color:var(--muted); margin:0 0 20px}
.login-form{display:grid; gap:8px}
.login-form label{font-size:13px; font-weight:700}
.login-form input{
  width:100%; border:1px solid var(--line); border-radius:6px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.login-form input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.login-form button{margin-top:8px}
.login-panel .notice{max-width:none; margin-bottom:16px}
/* The update gate (updateGateLayout). */
.gate-page{
  min-height:100vh; align-items:center; justify-content:center; padding:24px;
  background:var(--sidebar);
}
.gate-panel{
  width:100%; max-width:440px; border:1px solid var(--line); border-radius:10px;
  background:var(--surface); padding:28px; display:flex; flex-direction:column; gap:12px;
}
.gate-icon{display:block; width:48px; height:48px; border-radius:11px}
.gate-panel h1{font-size:22px; line-height:1.25; margin:4px 0 0}
.gate-text{margin:0; color:var(--fg-secondary); font-size:15px; line-height:1.55; overflow-wrap:anywhere}
.gate-notes{align-self:flex-start; font-size:14px}
.gate-progress{position:relative; height:4px; margin:6px 0; border-radius:2px; background:var(--line); overflow:hidden}
.gate-progress::after{
  content:""; position:absolute; top:0; bottom:0; left:0; width:35%; border-radius:2px;
  background:var(--accent); animation:gate-slide 1.4s ease-in-out infinite;
}
@keyframes gate-slide{from{transform:translateX(-100%)} to{transform:translateX(290%)}}
@media (prefers-reduced-motion:reduce){.gate-progress::after{animation:none; width:100%; opacity:.6}}
.gate-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:8px}
.gate-actions[hidden]{display:none}
/* compact highlight.js theme (github-ish) */
.hljs-comment,.hljs-quote{color:var(--hl-comment)}
.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:var(--hl-keyword)}
.hljs-string,.hljs-doctag,.hljs-regexp{color:var(--hl-string)}
.hljs-number,.hljs-built_in{color:var(--hl-number)}
.hljs-title,.hljs-section,.hljs-name{color:var(--hl-title)}
.hljs-attr,.hljs-attribute,.hljs-variable{color:var(--hl-attr)}
/* space switcher in the sidebar */
.space-switcher{margin:0 0 16px}
.space-current{display:block; font-weight:700; font-size:15px; color:var(--fg)}
.space-all{display:block; color:var(--muted); font-size:12px; margin-top:2px}
/* spaces landing page */
.spaces-page{display:block; background:var(--sidebar)}
.spaces-main{max-width:920px; margin:0 auto; padding:40px 24px}
.spaces-head{display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:28px}
.spaces-head h1{font-size:28px; line-height:1.2; margin:0}
.spaces-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px}
.space-card-wrap{position:relative; display:flex}
.space-card{
  flex:1; display:flex; flex-direction:column; gap:6px; padding:18px 18px 20px;
  border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--fg);
}
.space-card:hover{text-decoration:none; border-color:var(--focus-ring); box-shadow:var(--shadow-card)}
.space-icon{font-size:26px; line-height:1}
.space-card-title{font-weight:700; font-size:16px}
.space-summary{margin:0; color:var(--muted); font-size:13px; line-height:1.5}
.spaces-grid .empty{color:var(--muted)}
/* Per-space ⋯ menu, floated into the card's top-right corner. */
.space-menu{position:absolute; top:10px; right:10px}
.space-menu>summary{
  list-style:none; cursor:pointer; user-select:none;
  display:flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:6px; opacity:0; transition:opacity .1s ease;
  border:1px solid var(--line); background:var(--surface); color:var(--muted); font-size:16px; line-height:1;
}
.space-menu>summary::-webkit-details-marker{display:none}
.space-menu>summary::marker{content:""}
.space-card-wrap:hover .space-menu>summary,.space-menu[open]>summary{opacity:1}
.space-menu>summary:hover{background:var(--surface-hover-2); color:var(--fg)}
.space-menu-pop{
  position:absolute; right:0; top:32px; z-index:10; min-width:190px;
  background:var(--surface); border:1px solid var(--line); border-radius:6px;
  box-shadow:var(--shadow-md); padding:6px; display:flex; flex-direction:column; gap:4px;
}
.space-menu-pop form{margin:0}
.space-menu-pop>form:not(.menu-name-form)>button,.space-menu-pop>a{
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:6px 8px; border-radius:4px; color:var(--fg-secondary); font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit;
}
.space-menu-pop>form:not(.menu-name-form)>button:hover,.space-menu-pop>a:hover{
  background:var(--surface-hover); text-decoration:none;
}
.space-menu-pop>a{color:var(--error-fg)}
.space-menu-pop .menu-name-form{flex-direction:row; align-items:center; gap:4px}
.space-menu-pop .menu-name-form input[type=text]{flex:1; min-width:0}
.space-menu-pop .menu-name-form button{
  flex:0 0 auto; border:1px solid var(--line); border-radius:4px; background:var(--surface);
  padding:5px 8px; color:var(--fg-secondary); font-size:12px; font-weight:600; cursor:pointer; font-family:inherit;
}
.space-menu-pop .menu-name-form button:hover{background:var(--surface-hover-2)}
.space-confirm .confirm-actions{margin-top:12px}
/* Archived spaces wait below the rest, quieter, until restored. */
.spaces-archived{margin-top:40px}
.spaces-archived h2{margin:0 0 12px; color:var(--muted); font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase}
.space-card-wrap.is-archived .space-card{background:transparent; border-style:dashed; color:var(--fg-secondary)}
.spaces-foot{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:28px}
.new-space-form{display:flex; flex:1 1 auto; gap:8px}
.new-space-form input{
  flex:1; max-width:360px; border:1px solid var(--line); border-radius:6px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.new-space-form input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
/* Tasks dashboard (and the shared dashboard pieces: lede, stat cards).
   Rides the note palettes already defined for pins and marks — a task is purple
   here for the same reason it is purple on the page it was left on. */
.dash-lede{margin:0 0 20px; color:var(--fg-secondary); font-size:14px}
.stat-row{display:flex; flex-wrap:wrap; gap:12px; margin-bottom:28px}
.stat-card{
  display:flex; flex-direction:column; gap:2px; min-width:96px;
  padding:12px 16px; border:1px solid var(--line); border-radius:8px;
  background:var(--surface);
}
.stat-value{font-size:24px; font-weight:600; line-height:1.1; color:var(--fg)}
.stat-label{font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em}
.task-group{margin-bottom:24px}
.task-group-head{
  display:flex; align-items:baseline; gap:8px; margin:0 0 2px;
  font-size:15px; font-weight:600; border:none; padding:0;
}
.task-group-head a{color:var(--fg)}
/* Clipped to one line by height rather than by white-space:nowrap. Nowrap text
   raises the min-content width of everything around it, and .content is a flex
   item sized by its automatic minimum — one long trail widened the whole page. */
.task-crumb{
  margin:0 0 8px; max-height:1.4em; overflow:hidden;
  color:var(--muted); font-size:12px; line-height:1.4;
}
.task-count{
  flex:0 0 auto; padding:1px 8px; border-radius:10px;
  background:var(--task-bg); color:var(--task-fg); font-size:12px; font-weight:600;
}
.task-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px}
/* The row is the positioning context for the copy button pinned inside its
   top-right corner; .task-link reserves that corner in its own padding so no
   line of note text ever runs under it. */
.task-item{position:relative}
.task-link{
  display:flex; flex-direction:column; gap:3px;
  padding:10px 104px 10px 14px; border:1px solid var(--line); border-radius:6px;
  border-left:3px solid var(--task-pin); background:var(--surface); color:var(--fg);
}
.task-link:hover{background:var(--surface-hover); text-decoration:none}
/* The note's own handle. The id is shown, not just copied, so a reference pasted
   into a chat can be matched back to the row it came from; what lands on the
   clipboard is that id qualified with its page (space/…/page#id). Quiet until
   pointed at — it sits on every row, and a column of loud chips would compete
   with the notes themselves. */
.task-copy{
  position:absolute; top:9px; right:9px;
  display:inline-flex; align-items:center; gap:5px;
  padding:2px 7px; border:1px solid var(--line); border-radius:6px;
  background:var(--surface); color:var(--muted); cursor:pointer;
  font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.task-copy:hover{background:var(--surface-hover-2); border-color:var(--task-border); color:var(--fg)}
.task-copy:focus-visible{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.task-copy.copied{background:var(--success-bg); border-color:var(--success-border); color:var(--success-fg)}
.task-copy.copy-failed{background:var(--error-bg); border-color:var(--error-border); color:var(--error-fg)}
.task-quote{
  color:var(--task-fg); background:var(--task-bg); border-radius:2px;
  align-self:flex-start; padding:0 4px; font-size:13px;
}
.task-text{font-size:14px; line-height:1.45; white-space:pre-wrap}
.task-text.is-empty{color:var(--muted); font-style:italic}
.task-by{color:var(--muted); font-size:12px}
.dash-empty{color:var(--fg-secondary)}
.dash-back{display:inline-block; margin:0 0 12px; font-size:14px}
/* Dashboards hub: one card per report. */
.hub-grid{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px;
}
.hub-card{
  display:flex; flex-direction:column; gap:6px; height:100%;
  padding:16px 18px; border:1px solid var(--line); border-radius:8px;
  background:var(--surface); color:var(--fg);
}
.hub-card:hover{background:var(--surface-hover); text-decoration:none}
.hub-card:focus-visible{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.hub-title{font-size:16px; font-weight:600; color:var(--accent)}
.hub-stat{display:flex; align-items:baseline; gap:6px}
.hub-desc{font-size:13px; color:var(--fg-secondary); line-height:1.45}
/* Gallery. Each thumbnail box is square before its image loads, so a grid of
   lazy images never shifts the page as they arrive. */
.gallery-bar{display:flex; align-items:flex-start; justify-content:space-between; gap:20px; flex-wrap:wrap}
.gallery-bar .dash-lede{flex:1 1 320px; margin-bottom:12px}
.gallery-upload{flex:0 0 auto; margin:0}
.gallery-upload label{position:relative; cursor:pointer}
/* Out of sight but still focusable; the label is what is seen. */
.gallery-upload input[type="file"]{position:absolute; width:1px; height:1px; opacity:0; overflow:hidden}
.gallery-upload label:focus-within{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.gallery-upload.is-busy label{opacity:.7; pointer-events:none}
.gallery-count{margin:0 0 10px; color:var(--muted); font-size:13px}
.prose .gallery-grid{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); gap:14px;
}
.gallery-item{display:flex; flex-direction:column; gap:4px; min-width:0}
.gallery-thumb{
  display:block; aspect-ratio:1; overflow:hidden;
  border:1px solid var(--line); border-radius:8px; background:var(--code-bg);
}
.gallery-thumb:hover{border-color:var(--accent)}
.gallery-thumb:focus-visible{outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.gallery-item.is-new .gallery-thumb{border-color:var(--accent); box-shadow:0 0 0 2px var(--focus-ring-soft)}
.prose .gallery-thumb img{display:block; width:100%; height:100%; max-width:none; object-fit:contain; box-sizing:border-box}
/* Clipped by overflow rather than nowrap, which would widen the whole page
   (see .task-crumb). One click selects the whole reference, ready to paste. */
.prose .gallery-ref{
  display:block; max-height:1.5em; overflow:hidden; overflow-wrap:anywhere;
  padding:0; background:none; color:var(--fg-secondary); font-size:12px; user-select:all;
}
.gallery-size{color:var(--muted); font-size:12px}
.gallery-viewer{
  width:min(1100px,94vw); max-height:94vh; border:1px solid var(--line); border-radius:10px;
  padding:0; color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.gallery-viewer::backdrop{background:var(--backdrop)}
/* It sits inside .prose, whose h2 is underlined like a page's section. */
.gallery-viewer .help-head h2{font-size:15px; margin:0; padding:0; border:0; overflow-wrap:anywhere}
.gallery-viewer-frame{display:flex; justify-content:center; padding:16px 20px 0}
.prose .gallery-viewer-frame img{max-width:100%; max-height:72vh; object-fit:contain}
.gallery-viewer-foot{display:flex; align-items:center; justify-content:space-between; gap:8px 16px; flex-wrap:wrap; padding:12px 20px 16px}
.gallery-viewer-meta{margin:0; flex:1 1 200px; min-width:0; color:var(--muted); font-size:13px; overflow-wrap:anywhere}
.gallery-delete{flex:0 0 auto; margin:0}
.gallery-delete-confirm{display:inline-flex; align-items:center; gap:8px; color:var(--fg-secondary); font-size:13px}
.gallery-delete [hidden]{display:none}
/* Labels. A chip or dot reads its colours from --lc-*, which default to grey
   and are repointed by the data-label-color rule that follows. Chips wrap
   rather than nowrap: nowrap text inside .content widens the whole page. */
.label-chip,.label-dot{
  --lc-bg:var(--label-gray-bg); --lc-fg:var(--label-gray-fg); --lc-dot:var(--label-gray-dot);
}
${LABEL_COLOR_RULES}
.label-chips{display:inline-flex; flex-wrap:wrap; gap:4px; min-width:0}
.label-chip{
  display:inline-block; max-width:100%; padding:1px 8px; border-radius:999px;
  border:1px solid transparent; background:var(--lc-bg); color:var(--lc-fg);
  font-size:12px; font-weight:600; line-height:1.5; overflow-wrap:anywhere;
}
a.label-chip:hover{text-decoration:none; border-color:var(--lc-dot)}
.label-chip.is-orphan{border:1px dashed var(--lc-dot)}
.label-dot{
  display:inline-block; width:8px; height:8px; border-radius:50%;
  background:var(--lc-dot); flex:0 0 auto;
}
.page-labels{margin-bottom:8px}
.sr-only{
  position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); border:0;
}
/* The label dialog borrows the Help dialog's head and close button. */
.label-dialog,.folder-dialog{
  width:min(440px,92vw); border:1px solid var(--line); border-radius:10px;
  padding:0; color:var(--fg); background:var(--surface); box-shadow:var(--shadow-lg);
}
.label-dialog::backdrop,.folder-dialog::backdrop{background:var(--backdrop)}
.folder-dialog{width:min(400px,92vw)}
.folder-dialog-body{display:flex; flex-direction:column; gap:6px; padding:16px 20px 18px}
.folder-dialog-label{font-size:13px; font-weight:600; color:var(--fg-secondary)}
.folder-dialog-input{
  width:100%; border:1px solid var(--line); border-radius:6px; padding:8px 10px;
  color:var(--fg); background:var(--surface);
  font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.folder-dialog-input:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.folder-dialog-input[aria-invalid="true"]{border-color:var(--error-fg)}
.folder-dialog-hint{margin:0; color:var(--muted); font-size:12px; line-height:1.45; overflow-wrap:anywhere}
.folder-dialog-error{margin:0; color:var(--error-fg); font-size:12px; line-height:1.45}
.button:disabled{opacity:.5; cursor:not-allowed}
.label-dialog-form{margin:0}
.label-dialog-body{
  display:flex; flex-direction:column; gap:14px;
  padding:14px 20px; max-height:60vh; overflow:auto;
}
.label-dialog-page{margin:0; color:var(--fg-secondary); font-size:14px; font-weight:600; overflow-wrap:anywhere}
.label-dialog fieldset{border:0; margin:0; padding:0; min-width:0}
.label-dialog legend{
  padding:0; margin:0 0 6px; color:var(--muted);
  font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
}
.label-option{
  display:flex; align-items:center; gap:8px; min-width:0;
  padding:4px 6px; border-radius:6px; cursor:pointer;
}
.label-option:hover{background:var(--surface-hover-2)}
.label-option input{margin:0; flex:0 0 auto}
.label-dialog-empty{margin:0; color:var(--fg-secondary); font-size:13px}
.label-dialog-new input[type="text"]{
  width:100%; border:1px solid var(--line); border-radius:6px; padding:7px 10px;
  color:var(--fg); background:var(--surface);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.label-dialog-new input[type="text"]:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.label-swatches{display:flex; flex-wrap:wrap; gap:8px; margin-top:10px}
.label-swatch{position:relative; display:inline-flex; cursor:pointer}
.label-swatch input{position:absolute; inset:0; margin:0; opacity:0; cursor:pointer}
.label-swatch .label-dot{width:20px; height:20px; box-shadow:0 0 0 1px var(--line)}
.label-swatch input:checked + .label-dot{box-shadow:0 0 0 2px var(--surface), 0 0 0 4px var(--fg)}
.label-swatch input:focus-visible + .label-dot{outline:2px solid var(--focus-ring); outline-offset:4px}
.label-dialog-actions{
  display:flex; align-items:center; justify-content:flex-end; gap:8px;
  padding:12px 20px; border-top:1px solid var(--line);
}
.label-dialog-manage{margin-right:auto; font-size:13px}
/* A page nobody has opened since it appeared: an accent dot with a steady
   glow, no pulse, so it marks the row without pulling at the eye while reading. */
.tree-fresh,.tree-fresh-within{
  flex:0 0 auto; width:8px; height:8px; margin:0 8px 0 6px; border-radius:50%;
}
.tree-fresh{background:var(--accent); box-shadow:0 0 6px 1px var(--fresh-glow)}
/* A shut group hiding such a page: a hollow ring, quieter than the dot, so it
   reads as "in here" rather than "this one". Gone once the group is open and
   the dot itself is on screen. */
.tree-fresh-within{display:none; border:1.5px solid var(--accent)}
.tree li.collapsed > .tree-row > .tree-fresh-within{display:block}
.label-filter{display:flex; flex-direction:column; gap:12px; margin:0 0 24px}
/* A fieldset's default min-width is its min-content, which a long row of chips
   would push past the viewport. */
.label-filter-chips{display:flex; flex-wrap:wrap; gap:8px; border:none; margin:0; padding:0; min-width:0}
.label-filter-legend{
  float:left; width:100%; margin:0 0 4px; padding:0;
  font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;
}
.label-toggle{
  display:inline-flex; align-items:center; gap:6px; max-width:100%;
  padding:4px 10px 4px 8px; border:1px solid var(--line); border-radius:999px;
  background:var(--surface); cursor:pointer; font-size:13px;
}
.label-toggle:hover{background:var(--surface-hover-2)}
.label-toggle:has(input:checked){border-color:var(--accent); background:var(--active-bg)}
.label-toggle:has(input:focus-visible){outline:2px solid var(--focus-ring-soft); outline-offset:1px}
.label-toggle input{margin:0}
.label-count{color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums}
.label-search{display:flex; flex-wrap:wrap; align-items:center; gap:8px}
.label-search input[type="search"]{
  flex:1 1 220px; min-width:0; max-width:420px;
  border:1px solid var(--line); border-radius:6px; padding:7px 10px;
  color:var(--fg); background:var(--surface);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.label-search input[type="search"]:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.label-clear{font-size:14px}
.label-results-count{margin:0 0 8px; color:var(--muted); font-size:13px}
.label-results{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px}
.label-result{
  display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0;
  padding:10px 14px; border:1px solid var(--line); border-radius:6px; background:var(--surface);
}
.label-result-title{font-size:15px; font-weight:600; overflow-wrap:anywhere}
.label-result .task-crumb{margin:0}
.label-result-text{margin:0; color:var(--fg-secondary); font-size:13px; line-height:1.45; overflow-wrap:anywhere}
.label-manage{margin-top:40px; padding-top:20px; border-top:1px solid var(--line)}
.label-manage h2{margin:0 0 6px; font-size:18px; border:none; padding:0}
.label-manage .dash-lede{margin-bottom:14px}
.label-manage-list{list-style:none; margin:16px 0 0; padding:0; display:flex; flex-direction:column; gap:8px}
.label-manage-row{
  display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px;
  padding:10px 12px; border:1px solid var(--line); border-radius:6px; background:var(--surface);
}
.label-manage-form{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin:0; min-width:0}
.label-manage-form input[type="text"]{
  flex:0 1 200px; min-width:0; border:1px solid var(--line); border-radius:6px; padding:6px 10px;
  color:var(--fg); background:var(--surface);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.label-manage-form input[type="text"]:focus{outline:2px solid var(--focus-ring-soft); border-color:var(--focus-ring)}
.label-manage-row > .label-manage-form{flex:1 1 auto}
.label-manage-form .label-swatches{margin-top:0}
/* A row's colour (labelColorPicker): its dot, as tall as the name beside it,
   with the palette dropping below it. */
.label-color-pick{position:relative; flex:0 0 auto}
.label-color-pick > summary{
  display:flex; align-items:center; gap:6px; height:34px; padding:0 8px; list-style:none;
  border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--muted); cursor:pointer;
}
.label-color-pick > summary::-webkit-details-marker{display:none}
.label-color-pick > summary::marker{content:""}
.label-color-pick > summary:hover,.label-color-pick[open] > summary{background:var(--surface-hover-2); color:var(--fg)}
.label-color-pick > summary:focus-visible{outline:2px solid var(--focus-ring); outline-offset:2px}
.label-color-pick > summary .label-dot{width:18px; height:18px; box-shadow:0 0 0 1px var(--line)}
.label-color-chevron{transition:transform .12s ease}
.label-color-pick[open] .label-color-chevron{transform:rotate(180deg)}
.label-color-pop{
  position:absolute; z-index:30; top:calc(100% + 6px); left:0;
  width:max-content; max-width:min(320px, calc(100vw - 48px)); padding:10px 12px;
  border:1px solid var(--line); border-radius:8px; background:var(--surface); box-shadow:var(--shadow-lg);
}
.label-delete{margin-left:auto}
.label-delete-dialog:focus{outline:none}
/* It sits inside .prose, whose h2 is underlined like a page's section. */
.label-delete-dialog .help-head h2{margin:0; padding:0; border:0; overflow-wrap:anywhere}
.label-delete-body{padding:16px 20px}
.label-delete-body p{margin:0; color:var(--fg-secondary); font-size:14px; line-height:1.55; overflow-wrap:anywhere}
@media(max-width:780px){
  body{flex-direction:column}
  .sidebar{width:auto; flex:none; height:auto; position:static; border-right:none;
    border-bottom:1px solid var(--line)}
  /* iOS Safari zooms the viewport when focusing an input under 16px. */
  .sidebar-search-input{font-size:16px}
  .content{padding:20px}
  .page-head{display:block}
  .actions{margin-bottom:16px}
  /* Too little width to spend 90px of it on an id that is about to be copied
     anyway: the glyph alone keeps the button, and the tooltip keeps the id. */
  .task-copy .task-id{display:none}
  .task-link{padding-right:44px}
  /* Less left padding to hang the pin in, so it tucks in closer. */
  .note-pin{left:-17px; width:11px; height:11px}
}

/* --- space instructions editor -------------------------------------------- */
.instructions-hint{
  margin:0 0 18px; padding:14px 16px;
  border:1px solid var(--line); border-radius:10px;
  background:var(--surface); max-width:70ch;
}
.instructions-hint p{margin:0 0 8px; font-size:0.9rem; line-height:1.5}
.instructions-hint p:last-child{margin-bottom:0}
.instructions-meta{color:var(--muted)}
.instructions-count{
  font-variant-numeric:tabular-nums; color:var(--muted);
  font-size:0.85rem !important;
}
.instructions-count.over{color:var(--error-fg); font-weight:600}
/* The chat drawer: a column down the right edge. On a wide window the page
   makes room for it (body is a flex row, so its padding narrows the content)
   and the corner tools and update card move left with it; on a narrow one it
   covers the page, which its own close button gives back.
   It is dark in either theme: it wears the dark theme's colours, which
   everything in it reads, its native pickers and scrollbars included. */
.chat-drawer{
  ${DARK_TOKENS}
  position:fixed; top:0; right:0; bottom:0; z-index:55; width:400px; max-width:100vw;
  display:flex; flex-direction:column; background:var(--surface); color:var(--fg);
  border-left:1px solid var(--line); box-shadow:var(--shadow-md);
}
/* As in a dark page, an image in a reply sits on a light panel. */
.chat-drawer .prose img{background:#f0f3f6; padding:8px; border-radius:6px; filter:brightness(.9)}
.chat-drawer[hidden]{display:none}
/* Its parts toggle with the hidden attribute, which loses to any display rule
   (.button's, say) without this. */
.chat-drawer [hidden]{display:none}
body.chat-open{padding-right:400px}
body.chat-open .session-corner,body.chat-open .update-card{right:416px}
body.chat-open .tab-strip{right:400px}
/* The page loses the drawer's width, so the "On this page" rail needs that
   much more window to fit beside it (its own cutoff is 1180px). */
@media (max-width:1580px){body.chat-open .toc{display:none}}
@media (max-width:900px){
  body.chat-open{padding-right:0}
  body.chat-open .session-corner,body.chat-open .update-card{right:16px}
  body.chat-open .tab-strip{right:0}
  .chat-drawer{width:100vw; border-left:0}
}
/* The drawer's icons, drawn as masks so they take the colour of whatever they
   sit in. The chevron is the one exception: a select can't hold a pseudo-element,
   so it is a background in a grey that reads on both themes. */
.chat-drawer{
  --chat-sparkle:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z'/%3E%3C/svg%3E");
  --chat-pen:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 20h9'/%3E%3Cpath d='M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z'/%3E%3C/svg%3E");
  --chat-check:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='m8.5 12.5 2.5 2.5 4.5-5'/%3E%3C/svg%3E");
  --chat-page:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8'/%3E%3C/svg%3E");
  --chat-folder:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/%3E%3C/svg%3E");
  --chat-space:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z'/%3E%3Cpath d='m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65M22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65'/%3E%3C/svg%3E");
  --chat-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'/%3E%3C/svg%3E");
  --chat-chevron:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
}
.chat-head{display:flex; align-items:center; gap:2px; height:52px; padding:0 10px 0 18px; border-bottom:1px solid var(--line)}
.chat-title{flex:1; min-width:0; margin:0; font-size:14px; font-weight:600; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chat-engine{flex:0 0 auto; margin:0 6px 0 4px; padding:2px 8px; border-radius:999px; background:var(--surface-hover); color:var(--muted); font-size:11px; font-weight:600; line-height:1.5}
.chat-icon-button{
  display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:32px; height:32px; padding:0; border:0; border-radius:8px;
  background:transparent; color:var(--muted); font-size:18px; line-height:1; cursor:pointer;
  transition:background-color .15s, color .15s;
}
.chat-icon-button:hover{background:var(--surface-hover); color:var(--fg)}
.chat-icon-button svg{display:block}
.chat-log{flex:1; min-height:0; overflow:auto; padding:20px 18px 16px; display:flex; flex-direction:column; gap:16px}
.chat-msg{font-size:14px; line-height:1.6; overflow-wrap:anywhere}
/* The person's own messages sit right in a neutral bubble; the accent is kept
   for what can be pressed, and for Write to KB. */
.chat-user{align-self:flex-end; max-width:85%; padding:9px 14px; border-radius:18px 18px 6px 18px; background:var(--surface-hover)}
.chat-user-text{white-space:pre-wrap}
.chat-user-images{display:flex; flex-wrap:wrap; gap:6px; margin:3px 0 6px}
.chat-user-images:last-child{margin-bottom:3px}
.chat-user-images a{display:block; border-radius:10px; overflow:hidden; background:var(--surface)}
.chat-user-images img{display:block; height:96px; max-width:100%; object-fit:cover}
.chat-tag{display:flex; align-items:center; gap:5px; width:fit-content; margin:2px 0 5px; padding:1px 9px 1px 7px; border-radius:999px; background:var(--active-bg); color:var(--accent); font-size:11px; font-weight:600; line-height:1.7}
.chat-tag::before{content:""; flex:0 0 auto; width:11px; height:11px; background:currentColor; -webkit-mask:var(--chat-pen) center/contain no-repeat; mask:var(--chat-pen) center/contain no-repeat}
.chat-assistant > :first-child{margin-top:0}
.chat-assistant > :last-child{margin-bottom:0}
.chat-assistant :is(p,ul,ol){margin:.6em 0}
.chat-assistant :is(ul,ol){padding-left:1.35em}
.chat-assistant li{margin:.25em 0}
.chat-assistant li::marker{color:var(--muted)}
.chat-assistant :is(h1,h2,h3,h4,h5,h6){margin:1.2em 0 .4em; padding:0; border:0; font-size:15px; line-height:1.35}
/* The drawer is the colour code blocks are, so inline code takes the hover grey to stand out. */
.chat-assistant :not(pre) > code{background:var(--surface-hover)}
.chat-assistant pre{margin:.7em 0; padding:10px 12px; border-radius:10px; font-size:12.5px}
.chat-assistant table{display:block; overflow-x:auto; font-size:13px}
.chat-streaming{white-space:pre-wrap}
/* A caret at the end of the text while it is still arriving. */
.chat-streaming::after{content:""; display:inline-block; width:2px; height:1.05em; margin-left:2px; vertical-align:-.15em; border-radius:1px; background:var(--accent); animation:chat-caret 1s steps(1) infinite}
@keyframes chat-caret{50%{opacity:0}}
/* What a turn wrote: a quiet card, its success carried by the check rather than
   a green box, and each change a row with an icon for what it is. */
.chat-report{padding:6px; border:1px solid var(--line); border-radius:14px; background:var(--surface); box-shadow:var(--shadow-card)}
.chat-report-head{display:flex; align-items:center; gap:8px; padding:5px 8px 7px; font-size:13px; font-weight:600}
.chat-report-head::before{content:""; flex:0 0 auto; width:16px; height:16px; background:var(--success-fg); -webkit-mask:var(--chat-check) center/contain no-repeat; mask:var(--chat-check) center/contain no-repeat}
.chat-report-list{display:grid; gap:2px; margin:0; padding:0; list-style:none}
.chat-report-list li{--icon:var(--chat-page); position:relative; padding:7px 10px 7px 38px; border-radius:9px; background:var(--surface-hover-2); font-size:13.5px; line-height:1.45}
.chat-report-list li[data-what="folder"]{--icon:var(--chat-folder)}
.chat-report-list li[data-what="space"]{--icon:var(--chat-space)}
.chat-report-list li[data-what="image"]{--icon:var(--chat-image)}
.chat-report-list li::before{content:""; position:absolute; left:12px; top:10px; width:16px; height:16px; background:var(--muted); -webkit-mask:var(--icon) center/contain no-repeat; mask:var(--icon) center/contain no-repeat}
.chat-report-list a{font-weight:600}
.chat-report-verb{color:var(--muted)}
.chat-report-slug{display:block; margin-top:1px; color:var(--muted); font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.chat-report-gone{color:var(--muted); text-decoration:line-through}
.chat-error{padding:10px 12px; border:1px solid var(--error-border); border-radius:12px; background:var(--error-bg); color:var(--error-fg); font-size:13.5px; white-space:pre-wrap}
.chat-empty{margin:auto 0; display:flex; flex-direction:column; align-items:center; gap:14px; padding:0 16px 24px; color:var(--muted); font-size:13.5px; line-height:1.6; text-align:center}
.chat-empty p{max-width:32ch; margin:0}
.chat-empty-mark{display:grid; place-items:center; width:44px; height:44px; border-radius:14px; background:var(--active-bg)}
.chat-empty-mark::before{content:""; width:22px; height:22px; background:var(--accent); -webkit-mask:var(--chat-sparkle) center/contain no-repeat; mask:var(--chat-sparkle) center/contain no-repeat}
/* What the agent is doing: one line over the box, a pulsing sparkle and a
   shimmer running through the words. */
.chat-activity{
  padding:0 22px 8px; font-size:12.5px; line-height:1.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  background:linear-gradient(90deg, var(--muted) 0 38%, var(--fg) 50%, var(--muted) 62% 100%) 0 0/250% 100% no-repeat;
  -webkit-background-clip:text; background-clip:text; color:transparent;
  animation:chat-shimmer 2.4s linear infinite;
}
.chat-activity::before{content:""; display:inline-block; width:12px; height:12px; margin-right:8px; vertical-align:-1px; background:var(--accent); -webkit-mask:var(--chat-sparkle) center/contain no-repeat; mask:var(--chat-sparkle) center/contain no-repeat; animation:chat-pulse 1.4s ease-in-out infinite}
@keyframes chat-shimmer{from{background-position:100% 0} to{background-position:0 0}}
@keyframes chat-pulse{50%{transform:scale(.72); opacity:.5}}
@media (prefers-reduced-motion:reduce){
  .chat-activity,.chat-activity::before,.chat-streaming::after{animation:none}
  .chat-activity{background:none; color:var(--muted)}
}
/* The box is one card: what is attached, the text, and a toolbar along its
   foot with the paperclip, Write to KB and Send. Model and effort sit under it. */
.chat-form{display:grid; gap:6px; padding:4px 12px 12px}
.chat-composer{
  display:grid; gap:2px; padding:8px; border:1px solid var(--line); border-radius:18px;
  background:var(--bg); box-shadow:var(--shadow-card); transition:border-color .15s, box-shadow .15s;
}
.chat-composer:has(.chat-input:focus){border-color:var(--focus-ring); box-shadow:0 0 0 3px color-mix(in srgb, var(--focus-ring) 22%, transparent)}
.chat-drawer[data-pages] .chat-composer{border-color:var(--accent)}
.chat-attachments{display:flex; flex-wrap:wrap; gap:8px; padding:4px 4px 6px}
.chat-attachment{position:relative; width:56px; height:56px; border:1px solid var(--line); border-radius:10px; background:var(--surface-hover)}
.chat-attachment img{display:block; width:100%; height:100%; border-radius:9px; object-fit:cover}
.chat-attachment-remove{
  position:absolute; top:-6px; right:-6px; display:inline-flex; align-items:center; justify-content:center;
  width:20px; height:20px; padding:0 0 1px; border:2px solid var(--bg); border-radius:50%;
  background:var(--fg); color:var(--bg); font-size:13px; font-weight:700; line-height:1; cursor:pointer;
}
.chat-attachment-remove:hover{background:var(--error-fg)}
.chat-input{
  display:block; width:100%; min-height:44px; max-height:200px; resize:none; margin:0; padding:4px 6px;
  border:0; background:transparent; color:var(--fg); outline:none;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.chat-input::placeholder{color:var(--muted)}
.chat-toolbar{display:flex; align-items:center; gap:4px}
.chat-pages{
  position:relative; display:inline-flex; align-items:center; gap:6px; height:30px; margin-right:auto; padding:0 11px 0 9px;
  border:1px solid var(--line); border-radius:999px; color:var(--fg-secondary); font-size:12.5px; font-weight:500; line-height:1;
  cursor:pointer; user-select:none; transition:background-color .15s, color .15s, border-color .15s;
}
.chat-pages:hover{background:var(--surface-hover)}
.chat-pages svg{display:block; flex:0 0 auto}
.chat-pages input{position:absolute; width:1px; height:1px; margin:0; opacity:0; pointer-events:none}
.chat-pages:has(input:focus-visible){outline:2px solid var(--focus-ring); outline-offset:1px}
.chat-drawer[data-pages] .chat-pages{border-color:transparent; background:var(--active-bg); color:var(--accent); font-weight:600}
.chat-send{
  display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:32px; height:32px; padding:0;
  border:0; border-radius:50%; background:var(--accent); color:var(--on-accent); cursor:pointer;
  transition:background-color .15s, opacity .15s, transform .1s;
}
.chat-send:hover{background:color-mix(in srgb, var(--accent) 85%, var(--fg))}
.chat-send:active{transform:scale(.92)}
.chat-send:focus-visible{outline:2px solid var(--focus-ring); outline-offset:2px}
.chat-send svg{display:block}
.chat-stop{background:var(--fg); color:var(--bg)}
.chat-stop:hover{background:var(--fg-secondary)}
/* Nothing to send yet: Send waits, faded. */
.chat-composer:has(.chat-input:placeholder-shown):has(.chat-attachments[hidden]) .chat-send:not(.chat-stop){opacity:.35; background:var(--accent); cursor:default; transform:none}
.chat-meta{display:flex; flex-wrap:wrap; align-items:center; gap:2px; padding:0 4px}
.chat-engines{display:inline-flex; flex:0 0 auto; margin-right:4px; padding:2px; border:1px solid var(--line); border-radius:999px}
.chat-engines button{
  padding:2px 10px; border:0; border-radius:999px; background:transparent; color:var(--muted); cursor:pointer;
  font:600 11.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  transition:background-color .15s, color .15s;
}
.chat-engines button:hover{color:var(--fg)}
.chat-engines button[aria-checked="true"]{background:var(--active-bg); color:var(--accent)}
.chat-select{
  flex:0 1 auto; min-width:0; max-width:100%; -webkit-appearance:none; appearance:none;
  padding:4px 22px 4px 8px; border:0; border-radius:8px;
  background:transparent var(--chat-chevron) right 6px center/12px 12px no-repeat;
  color:var(--muted); cursor:pointer; text-overflow:ellipsis; field-sizing:content;
  font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  transition:background-color .15s, color .15s;
}
.chat-select:hover{background-color:var(--surface-hover); color:var(--fg)}
.chat-select:focus-visible{outline:2px solid var(--focus-ring); outline-offset:-1px}
.chat-select:disabled{opacity:.6; cursor:default}
.chat-select:disabled:hover{background-color:transparent; color:var(--muted)}
.chat-drop{
  position:absolute; inset:10px; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;
  border:1.5px dashed var(--accent); border-radius:16px; background:var(--active-bg);
  color:var(--accent); font-size:14px; font-weight:600; pointer-events:none;
}
.chat-drop::before{content:""; width:28px; height:28px; background:currentColor; -webkit-mask:var(--chat-image) center/contain no-repeat; mask:var(--chat-image) center/contain no-repeat}
.chat-history{position:absolute; top:52px; left:0; right:0; bottom:0; z-index:1; overflow:auto; padding:8px; background:var(--surface)}
.chat-history-row{display:flex; align-items:center; gap:2px; padding-right:4px; border-radius:10px; transition:background-color .15s}
.chat-history-row:hover{background:var(--surface-hover)}
.chat-history-row.is-current{background:var(--active-bg)}
.chat-history-open{
  flex:1; min-width:0; display:grid; gap:1px; padding:9px 12px; border:0; border-radius:10px;
  background:transparent; color:var(--fg); text-align:left; font:inherit; cursor:pointer;
}
.chat-history-title{font-size:13.5px; font-weight:500; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chat-history-when{color:var(--muted); font-size:12px; line-height:1.4}
/* Delete shows on the row under the pointer, or one reached by keyboard. */
.chat-history-row .chat-icon-button{opacity:0}
.chat-history-row:hover .chat-icon-button,.chat-history-row:focus-within .chat-icon-button{opacity:1}
.chat-history-row .chat-icon-button:hover{background:var(--error-bg); color:var(--error-fg)}
@media (hover:none){.chat-history-row .chat-icon-button{opacity:1}}
.chat-history .chat-empty{padding:40px 16px}
.chat-setup{display:grid; gap:12px; align-content:start; justify-items:start; padding:18px; color:var(--fg-secondary); font-size:14px; line-height:1.6}
.chat-setup p{margin:0}
.chat-setup code{padding:1px 5px; border-radius:4px; background:var(--code-bg); font-size:13px; overflow-wrap:anywhere}
`;
