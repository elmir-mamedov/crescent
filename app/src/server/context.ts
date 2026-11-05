import type { Content } from "../content.js";
import type { Git } from "../git.js";
import type { KbWrites } from "../kb-writes.js";
import type { SeenPages } from "../seen.js";
import type { Render } from "./render.js";

/** The site the route modules serve: its settings and the KB behind it. */
export interface Site {
  /** SITE_TITLE, which every page's title carries. */
  siteTitle: string;
  /** The account's name, which the views show; "" with sign-in off, which they read as no account. */
  username: string;
  content: Content;
  git: Git;
  /** Every write the viewer makes goes through here, which commits it. */
  writes: KbWrites;
  /** The pages opened in this viewer; the sidebar marks the rest as new. */
  seen: SeenPages;
}

/** What each route module is handed: the site, and the pages several of them draw. */
export interface ServerContext extends Site {
  render: Render;
}
