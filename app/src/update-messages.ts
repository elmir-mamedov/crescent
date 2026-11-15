/**
 * A message from crescent's developers to the people updating to a version,
 * keyed by that version. The card a page shows after an update (update.ts,
 * UPDATE_SCRIPT in views/corner.ts) puts it above the link to the release
 * notes; a release without one shows only the link. Write it for someone who
 * is not a developer, in a sentence or two, and only for what they must do or
 * know after updating: the release notes hold the rest. Someone who skipped
 * releases sees the message of each one since their last update, oldest first.
 * Plain text: a line break shows as one, and nothing in it is HTML.
 */
export const UPDATE_MESSAGES: Readonly<Record<string, string>> = {
  "0.21.1":
    "If you use crescent from the Claude app or Claude Code, restart it to use this version there: quit the Claude app completely and open it again, and start a new Claude Code session. Until then, Claude can't add images to your pages.",
  "0.23.0":
    "If you use crescent from the Claude app or Claude Code, restart it to use this version there: quit the Claude app completely and open it again, and start a new Claude Code session. Until then, Claude can't add moving or interactive figures to your pages.\n\n" +
    "Claude now learns how to write your pages from crescent itself, in the Claude app as well as in Claude Code, so this update removed the page-writing skill crescent used to keep in Claude Code. If you had changed that skill, it was left as it is, and it won't be updated again: delete the kb-page-authoring folder in .claude/skills, in your home folder, once you no longer need it.",
};
