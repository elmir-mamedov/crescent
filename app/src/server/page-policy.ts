/**
 * What a reply may be framed by, and what a page may load.
 *
 * No other site may show Crescent in a frame. A page that framed it could lay
 * its own decoy over Crescent and steer a click onto a button underneath:
 * Delete space, Archive, Install the update. With sign-in off a click inside
 * the frame is Crescent's own, so the Origin check lets it through (Security
 * Review 2026-10, F5). Crescent frames nothing of its own but a page's
 * widgets, at `/_embed/…`, whose policy lets only Crescent's pages frame them
 * (`embedHeaders` in assets.ts).
 *
 * And a page loads images, sound, video and fonts only from Crescent itself.
 * What a page holds is untrusted, and anything it loads from another site
 * would tell that site the page was opened, with whatever its address carries
 * (Security Review 2026-11, N1). The renderer already shows an image from
 * anywhere but a space's `_assets/` as a link (createRenderer in markdown.ts);
 * this is what holds if anything gets past it. `data:` and `blob:` are
 * Crescent's own drawings and previews, and load nothing.
 */
import type { FastifyInstance } from "fastify";

/** The policy a reply that sets none of its own is sent with: every page's. */
export const PAGE_POLICY = [
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
].join("; ");

export function registerPagePolicy(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    // A widget is framed by Crescent's own pages; its policy says so already.
    if (!new URL(req.url, "http://localhost").pathname.startsWith("/_embed/")) {
      reply.header("x-frame-options", "DENY");
    }
    // An asset or a widget is sent with a policy of its own, kept as it is: an
    // asset is never framed either, and X-Frame-Options covers it.
    if (!reply.getHeader("content-security-policy")) reply.header("content-security-policy", PAGE_POLICY);
    return payload;
  });
}
