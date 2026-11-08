/**
 * `npm run dev:reset`: replace the KB a checkout's server opens with a fresh
 * copy of the sample spaces in dev/seed/. `npm run dev` runs it first with
 * `--if-missing`, so a new checkout starts with a KB to test in.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetDevKb } from "./dev-kb.js";
import { loadEnvFile } from "./env-file.js";

// The KB server.ts opens, found the same way.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, "..", "..", ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));
const kbDir = path.resolve(process.env.KB_DIR ?? path.join(__dirname, "..", "..", "kb"));

try {
  const spaces = await resetDevKb(kbDir, { ifMissing: process.argv.includes("--if-missing") });
  if (spaces) console.log(`Sample KB ready in ${kbDir}: ${spaces.join(", ")}.`);
} catch (error) {
  console.error(`dev:reset: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
