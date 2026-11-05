/**
 * What the server tells the views once, at startup (configureViews), and every
 * page reads as it renders. The bindings are live: a module that imports
 * `desktop` sees whatever configureViews last set.
 */

/** Set once at startup by {@link configureViews}; read by every page. */
export let desktop = false;
export let changeCursor: (() => string) | undefined;

/**
 * `desktop`: a launcher started this server (KB25_DESKTOP), so the corner
 * offers Quit (QUIT_SCRIPT) to a page in an ordinary browser tab.
 * `changeCursor`: where the KB's change feed is (changes.ts), which a page is
 * rendered with so that it follows the changes after it (CHANGES_SCRIPT).
 */
export function configureViews(options: { desktop: boolean; changeCursor?: () => string }): void {
  desktop = options.desktop;
  changeCursor = options.changeCursor;
}
