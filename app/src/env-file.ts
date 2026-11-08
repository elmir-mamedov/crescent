/**
 * `.env` files: KEY=value lines, one per setting, `#` comments, and values
 * optionally in matching quotes. The server and the MCP server read their
 * settings from them, and the dev tools read an installed copy's.
 */
import fs from "node:fs";

/** The settings in a `.env` file; none when it does not exist. */
export function readEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/**
 * Copy a `.env` file's settings into process.env. A variable that is already
 * set wins, so a real environment variable beats every file, and the first
 * file loaded beats the ones after it.
 */
export function loadEnvFile(filePath: string): void {
  for (const [key, value] of Object.entries(readEnvFile(filePath))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
