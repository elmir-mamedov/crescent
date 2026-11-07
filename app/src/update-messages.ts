/**
 * A message from Crescent's developers to the people updating to a version,
 * keyed by that version. The card a page shows after an update (update.ts,
 * UPDATE_SCRIPT in views/corner.ts) puts it above the link to the release
 * notes; a release without one shows only the link. Write it for someone who
 * is not a developer, in a sentence or two, and only for what they must do or
 * know after updating: the release notes hold the rest. Someone who skipped
 * releases sees the message of each one since their last update, oldest first.
 * Plain text: a line break shows as one, and nothing in it is HTML.
 */
export const UPDATE_MESSAGES: Readonly<Record<string, string>> = {};
