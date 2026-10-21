import { spawn } from "node:child_process";

/**
 * `raw` as a web address to hand the default browser, or null. The address
 * comes from a page, so nothing but http(s) gets through: no file:, no other
 * scheme's handler, and, normalized by URL, no quote or space a command line
 * could split on.
 */
export function webAddress(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The command that opens `href` in the default browser. None goes through a
 * shell: `cmd /c start`, the usual one on Windows, would run whatever follows
 * an `&` in the address.
 */
export function browserCommand(href: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === "darwin") return ["open", [href]];
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", href]];
  return ["xdg-open", [href]];
}

/** Open a web address from {@link webAddress} in the default browser. */
export function openInBrowser(href: string): void {
  const [command, args] = browserCommand(href);
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    .on("error", () => {})
    .unref();
}
