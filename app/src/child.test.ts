import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { run } from "./child.js";

const SRC = import.meta.dirname;

test("run: resolves with what the program printed", async () => {
  const { stdout } = await run(process.execPath, ["-e", "process.stdout.write('ok')"]);
  assert.equal(stdout, "ok");
});

test("run: rejects when the program fails", async () => {
  await assert.rejects(run(process.execPath, ["-e", "process.exit(3)"]));
});

/** Every .ts file under src that ships, not a test's. */
async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(full)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && entry.name !== "test-helpers.ts") {
      out.push(full);
    }
  }
  return out;
}

/** Each call to the function `name` in `src` (not a method of that name), to its closing parenthesis. */
function calls(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![.\\w])${name}\\(`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

// On Windows each console program the server runs without windowsHide opens a
// console window of its own, which flashes on screen (git, on most page loads).
test("child processes: none is started with a console window on Windows", async () => {
  for (const file of await sources(SRC)) {
    const src = await fs.readFile(file, "utf8");
    if (!src.includes('"node:child_process"')) continue;
    const rel = path.relative(SRC, file);
    if (rel !== "child.ts") assert.doesNotMatch(src, /promisify\(execFile\)/, `${rel}: use run() from child.ts`);
    for (const name of ["execFile", "execFileSync", "spawn", "exec", "execSync"]) {
      for (const call of calls(src, name)) {
        if (rel === "child.ts" && name === "execFile") continue;
        assert.match(call, /windowsHide: true/, `${rel}: ${call.split("\n")[0]}`);
      }
    }
  }
});
