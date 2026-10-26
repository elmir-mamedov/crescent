/**
 * Page labels: the curated, coloured markers a person sets from the sidebar.
 *
 * A page lists the label *names* it carries in its frontmatter (`labels:`);
 * the space's palette, `<space>/_labels.json`, owns what each name looks like.
 * The underscore keeps the palette out of the tree, search and the note sweep,
 * exactly as it does for `_instructions.md` and `_assets/`, and living inside
 * the space folder puts it in that space's own git repo.
 *
 * A name on a page that the palette does not define is an orphan — left by a
 * hand edit, the editor, or an agent's full-page rewrite. It still counts for
 * filtering and renders grey, so nothing a person wrote silently disappears.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { flatten, type Content, type PageNode, type TreeFilter } from "./content.js";
import { cleanLabelNames, labelKey, normalizeLabelName } from "./frontmatter.js";

/**
 * The fixed palette. Named rather than free hex so every swatch can carry a
 * light and a dark variant that both stay legible; the CSS owns the values.
 */
export const LABEL_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export interface LabelDef {
  name: string;
  color: LabelColor;
}

/** A label as a view lists it: its look, how many pages carry it, and whether the palette knows it. */
export interface KnownLabel extends LabelDef {
  /** False for an orphan — a name pages carry that the palette does not define. */
  defined: boolean;
  count: number;
}

export const LABELS_FILE = "_labels.json";

/** The colour an orphan, or an unknown colour in a hand-edited palette, falls back to. */
const FALLBACK_COLOR: LabelColor = "gray";

export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === "string" && (LABEL_COLORS as readonly string[]).includes(value);
}

/** Absolute path of a space's palette, or null when the key cannot name a space. */
export function labelsFilePath(content: Content, space: string): string | null {
  const dir = content.spaceDir(space);
  return dir ? path.join(dir, LABELS_FILE) : null;
}

/**
 * Parse a palette file. Strict mode throws on anything malformed so a
 * mutation never rewrites a file it could not fully read; lenient mode keeps
 * what it can, because a page should still render around a typo.
 */
function parsePalette(raw: string, strict: boolean): LabelDef[] {
  const data: unknown = JSON.parse(raw);
  const list =
    data && typeof data === "object" && Array.isArray((data as { labels?: unknown }).labels)
      ? ((data as { labels: unknown[] }).labels)
      : null;
  if (!list) throw new Error('expected an object with a "labels" list');

  const seen = new Set<string>();
  const out: LabelDef[] = [];
  for (const entry of list) {
    const name =
      entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name.trim()
        : "";
    const key = labelKey(name);
    if (!key || seen.has(key)) {
      if (strict) throw new Error(`a label entry has a missing or repeated name`);
      continue;
    }
    seen.add(key);
    const color = (entry as { color?: unknown }).color;
    out.push({ name, color: isLabelColor(color) ? color : FALLBACK_COLOR });
  }
  return out;
}

const paletteCache = new Map<string, { mtimeMs: number; labels: LabelDef[] }>();

/**
 * A space's palette for rendering. Never throws: a missing file is an empty
 * palette and a broken one reads as empty too, so every page still renders
 * (its labels in grey) while the file waits to be fixed. Cached by mtime — the
 * sidebar asks on every request.
 */
export async function loadLabelSet(content: Content, space: string): Promise<LabelDef[]> {
  const file = labelsFilePath(content, space);
  if (!file) return [];

  let mtimeMs: number;
  try {
    // A symbolic link is never followed (Content.fileState): no palette.
    if ((await content.fileState(file)) !== "file") throw new Error("no palette");
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch {
    paletteCache.delete(file);
    return [];
  }
  const cached = paletteCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.labels;

  let labels: LabelDef[];
  try {
    labels = parsePalette(await fs.readFile(file, "utf8"), false);
  } catch {
    labels = [];
  }
  paletteCache.set(file, { mtimeMs, labels });
  return labels;
}

/**
 * The palette a mutation starts from: empty when absent, an error when
 * unreadable. Every save reads through here first, so refusing a palette that
 * is a symbolic link also keeps the save from writing wherever it points.
 */
async function readPaletteStrict(content: Content, file: string, space: string): Promise<LabelDef[]> {
  const state = await content.fileState(file);
  if (state === "missing") return [];
  if (state === "other") {
    throw new Error(
      `The label palette ${space}/${LABELS_FILE} is not a plain file; Crescent does not follow symbolic links. Remove it, then try again.`
    );
  }
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  try {
    return parsePalette(raw, true);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `The label palette ${space}/${LABELS_FILE} could not be read (${reason}). Fix or remove the file, then try again.`
    );
  }
}

async function savePalette(file: string, labels: LabelDef[]): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify({ labels }, null, 2)}\n`, "utf8");
  paletteCache.delete(file);
}

function requirePaletteFile(content: Content, space: string): string {
  const file = labelsFilePath(content, space);
  if (!file) throw new Error(`"${space}" is not a space.`);
  return file;
}

/**
 * Label mutations read the palette, change it and rewrite pages; two of them
 * interleaving would lose one's palette write. Chaining them through one
 * promise runs them one at a time within this process.
 */
let mutationChain: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.catch(() => undefined);
  return run;
}

function findLabel(set: readonly LabelDef[], name: string): LabelDef | undefined {
  const key = labelKey(name);
  return set.find((label) => labelKey(label.name) === key);
}

export function colorOf(set: readonly LabelDef[], name: string): LabelColor {
  return findLabel(set, name)?.color ?? FALLBACK_COLOR;
}

/**
 * Every page in a space, its landing page included, in navigation order —
 * the same set search scopes to. Folders come along; they carry no labels.
 */
export async function spaceNodes(
  content: Content,
  space: string,
  filter: TreeFilter
): Promise<PageNode[]> {
  const key = content.spaceKeyOf(space);
  if (!key) return [];
  const node = (await content.tree(filter)).find((n) => n.slug === key);
  return node ? flatten([node]) : [];
}

/** How many of the given pages carry each label, keyed by `labelKey`. */
export function labelUsage(nodes: readonly PageNode[]): Map<string, { name: string; count: number }> {
  const usage = new Map<string, { name: string; count: number }>();
  for (const node of nodes) {
    for (const name of node.labels ?? []) {
      const key = labelKey(name);
      const entry = usage.get(key);
      if (entry) entry.count += 1;
      else usage.set(key, { name, count: 1 });
    }
  }
  return usage;
}

/**
 * The labels worth offering in a space: the palette in its own order, then any
 * orphans the pages carry, alphabetically. Orphans are listed so a person can
 * still filter by them and take them off a page.
 */
export function knownLabels(set: readonly LabelDef[], nodes: readonly PageNode[]): KnownLabel[] {
  const usage = labelUsage(nodes);
  const known: KnownLabel[] = set.map((label) => ({
    ...label,
    defined: true,
    count: usage.get(labelKey(label.name))?.count ?? 0,
  }));
  const orphans: KnownLabel[] = [];
  for (const [key, { name, count }] of usage) {
    if (findLabel(set, key)) continue;
    orphans.push({ name, color: FALLBACK_COLOR, defined: false, count });
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name));
  return [...known, ...orphans];
}

/** True when the page carries every one of the given label keys. */
export function hasAllLabels(node: PageNode, keys: readonly string[]): boolean {
  const own = new Set((node.labels ?? []).map(labelKey));
  return keys.every((key) => own.has(key));
}

/**
 * Of the given pages, those that carry every selected label, order kept. With
 * nothing selected, every page that carries any label at all.
 */
export function filterLabelled(nodes: readonly PageNode[], selected: readonly string[]): PageNode[] {
  const keys = selected.map(labelKey).filter(Boolean);
  return nodes.filter(
    (node) => !node.isFolder && (node.labels?.length ?? 0) > 0 && hasAllLabels(node, keys)
  );
}

/** The pages in a space that carry every selected label, in navigation order. */
export async function labelledPages(
  content: Content,
  space: string,
  filter: TreeFilter,
  selected: readonly string[]
): Promise<PageNode[]> {
  return filterLabelled(await spaceNodes(content, space, filter), selected);
}

export interface LabelMutation {
  /** Every file written: the palette and/or the pages rewritten. Empty when nothing changed. */
  changedFsPaths: string[];
  /** The label's name after the change, for messages. */
  name: string;
}

/** Add a label to a space's palette. */
export function createLabel(
  content: Content,
  space: string,
  rawName: string,
  color: string
): Promise<LabelMutation> {
  return serialized(async () => {
    const file = requirePaletteFile(content, space);
    const set = await readPaletteStrict(content, file, space);
    const name = normalizeLabelName(rawName);
    if (!isLabelColor(color)) throw new Error(`"${color}" is not one of the label colours.`);
    if (findLabel(set, name)) throw new Error(`A label named "${name}" already exists.`);
    await savePalette(file, [...set, { name, color }]);
    return { changedFsPaths: [file], name };
  });
}

/**
 * Rewrite one label on every page in the space that carries it — archived
 * pages included, or restoring one would bring a renamed or deleted label back.
 */
async function rewritePages(
  content: Content,
  space: string,
  name: string,
  replace: (labels: string[]) => string[]
): Promise<string[]> {
  const key = labelKey(name);
  const changed: string[] = [];
  for (const node of await spaceNodes(content, space, "all")) {
    if (!node.labels?.some((label) => labelKey(label) === key)) continue;
    const result = await content.setLabels(node.slug, replace(node.labels));
    if (result) changed.push(...result.changedFsPaths);
  }
  return changed;
}

/**
 * Rename and/or recolour a label. A rename rewrites every page carrying it in
 * the same mutation, so one commit holds the whole change. Changing only the
 * case of a name is a rename; taking another label's name is refused. An
 * orphan can be updated too — doing so adds it to the palette.
 */
export function updateLabel(
  content: Content,
  space: string,
  currentName: string,
  change: { name?: string; color?: string }
): Promise<LabelMutation> {
  return serialized(async () => {
    const file = requirePaletteFile(content, space);
    const set = await readPaletteStrict(content, file, space);
    const existing = findLabel(set, currentName);
    const current: LabelDef = existing ?? { name: currentName.trim(), color: FALLBACK_COLOR };
    if (!labelKey(current.name)) throw new Error("Choose a label to change.");

    const name = change.name === undefined ? current.name : normalizeLabelName(change.name);
    if (labelKey(name) !== labelKey(current.name) && findLabel(set, name)) {
      throw new Error(`A label named "${name}" already exists.`);
    }
    const color = change.color === undefined ? current.color : change.color;
    if (!isLabelColor(color)) throw new Error(`"${color}" is not one of the label colours.`);

    const renamed = name !== current.name;
    const changed: string[] = [];
    if (!existing || renamed || color !== current.color) {
      const next = existing
        ? set.map((label) => (label === existing ? { name, color } : label))
        : [...set, { name, color }];
      await savePalette(file, next);
      changed.push(file);
    }
    if (renamed) {
      const key = labelKey(current.name);
      changed.push(
        ...(await rewritePages(content, space, current.name, (labels) =>
          labels.map((label) => (labelKey(label) === key ? name : label))
        ))
      );
    }
    return { changedFsPaths: changed, name };
  });
}

/** Remove a label from the palette and from every page in the space that carries it. */
export function deleteLabel(
  content: Content,
  space: string,
  rawName: string
): Promise<LabelMutation> {
  return serialized(async () => {
    const file = requirePaletteFile(content, space);
    const set = await readPaletteStrict(content, file, space);
    const existing = findLabel(set, rawName);
    const name = existing?.name ?? rawName.trim();
    const key = labelKey(name);
    if (!key) throw new Error("Choose a label to delete.");

    const changed: string[] = [];
    if (existing) {
      await savePalette(
        file,
        set.filter((label) => label !== existing)
      );
      changed.push(file);
    }
    changed.push(
      ...(await rewritePages(content, space, name, (labels) =>
        labels.filter((label) => labelKey(label) !== key)
      ))
    );
    if (!changed.length) throw new Error(`No label named "${name}" in this space.`);
    return { changedFsPaths: changed, name };
  });
}

/**
 * Set the labels on one page, optionally defining a new label and applying it
 * in the same step (the dialog's "New label" row).
 *
 * Each name is matched to the palette's own spelling, so a page never ends up
 * with "draft" beside a palette "Draft". A name the palette does not know is
 * accepted only if the page already carries it — an orphan may stay, but a
 * fresh one cannot be invented here. Null when the page does not exist.
 */
export function applyPageLabels(
  content: Content,
  slug: string,
  names: readonly string[],
  create?: { name: string; color: string }
): Promise<LabelMutation | null> {
  return serialized(async () => {
    const space = content.spaceKeyOf(slug);
    const file = requirePaletteFile(content, space);
    const page = await content.load(slug);
    if (!page) return null;

    let set = await readPaletteStrict(content, file, space);
    let paletteGrew = false;
    const wanted = [...names];
    if (create && create.name.trim()) {
      const name = normalizeLabelName(create.name);
      const existing = findLabel(set, name);
      if (existing) {
        wanted.push(existing.name);
      } else {
        if (!isLabelColor(create.color)) {
          throw new Error(`"${create.color}" is not one of the label colours.`);
        }
        set = [...set, { name, color: create.color }];
        paletteGrew = true;
        wanted.push(name);
      }
    }

    // Every name is checked before anything is written, so a refusal leaves
    // neither a half-applied page nor an uncommitted palette behind.
    const onPage = cleanLabelNames(page.data.labels ?? []);
    const resolved = cleanLabelNames(wanted).map((name) => {
      const defined = findLabel(set, name);
      if (defined) return defined.name;
      const kept = onPage.find((label) => labelKey(label) === labelKey(name));
      if (kept) return kept;
      throw new Error(`There is no label named "${name}" in this space — create it first.`);
    });

    const changed: string[] = [];
    if (paletteGrew) {
      await savePalette(file, set);
      changed.push(file);
    }
    const result = await content.setLabels(slug, resolved);
    if (!result) return null;
    changed.push(...result.changedFsPaths);
    return { changedFsPaths: changed, name: page.data.title };
  });
}
