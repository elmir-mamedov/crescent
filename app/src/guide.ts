/**
 * The getting-started guide: pages that show a person how to use crescent,
 * read from Help. It ships with the app, in guide/, and Help reads it from
 * there, read-only (server/guide.ts): it can't be deleted, and every update
 * replaces it, so it is always current. It is not copied into the knowledge
 * base; what a new knowledge base gets is the example space
 * (example-space.ts), which the tour (views/tour.ts) shows around.
 */
import path from "node:path";

/** The guide's space key: the folder in guide/ that holds its pages. */
export const GUIDE_SPACE = "getting-started";

/** Where crescent keeps the guide: guide/ beside src/ or server/. */
export function guideRoot(appDir: string): string {
  return path.join(appDir, "guide");
}
