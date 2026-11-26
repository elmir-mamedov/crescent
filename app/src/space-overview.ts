/**
 * What a space holds besides its pages, for the Dashboards hub to open with:
 * the Mermaid diagrams its pages draw and the widgets in its `_assets`. Its
 * images are the gallery's (`listImages`), and its pages `countPages`.
 */
import { isWidgetName } from "./assets.js";
import type { Content, PageNode } from "./content.js";
import { assetFiles } from "./gallery.js";
import { countDiagrams } from "./markdown.js";
import { mapWithConcurrency } from "./search.js";

/**
 * How many Mermaid diagrams the given pages draw between them. A folder has
 * no body to draw one in, and a page that cannot be read draws none, as the
 * notes dashboard skips it too.
 */
export async function countSpaceDiagrams(content: Content, nodes: readonly PageNode[]): Promise<number> {
  const counts = await mapWithConcurrency([...nodes], 32, async (node) => {
    if (node.isFolder) return 0;
    try {
      const page = await content.load(node.slug);
      return page ? countDiagrams(page.body) : 0;
    } catch {
      return 0;
    }
  });
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * How many widgets a space has: the HTML files in its `_assets`, subfolders
 * included, shown on a page or not, the way the gallery counts its images.
 */
export async function countWidgets(content: Content, spaceKey: string): Promise<number> {
  return (await assetFiles(content, spaceKey, isWidgetName)).length;
}
