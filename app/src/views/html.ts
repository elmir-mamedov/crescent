/**
 * What every view builds with: HTML escaping, and the viewer's own URLs.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugPath(slug: string): string {
  if (!slug) return "/";
  return "/" + slug.split("/").map(encodeURIComponent).join("/");
}

/** Where a space's archive lives: its archived pages, and only its own. */
export function archiveHref(spaceKey: string): string {
  return `/_archive?space=${encodeURIComponent(spaceKey)}`;
}

/** Where the current space's Dashboards hub lives. */
export function dashboardsHref(spaceKey: string): string {
  return `/_dashboard?space=${encodeURIComponent(spaceKey)}`;
}

/** Where the current space's image gallery lives. */
export function galleryHref(spaceKey: string): string {
  return `/_gallery?space=${encodeURIComponent(spaceKey)}`;
}

/** Where the Labels view lives, filtered to the given labels and query. */
export function labelsHref(spaceKey: string, labels: readonly string[] = [], query = ""): string {
  const params = new URLSearchParams({ space: spaceKey });
  for (const label of labels) params.append("label", label);
  if (query) params.set("q", query);
  return `/_dashboard/labels?${params.toString()}`;
}
