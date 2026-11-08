import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnvFile, readEnvFile } from "./env-file.js";
import { makeTempKb } from "./test-helpers.js";

test("readEnvFile reads settings, skips comments and unquotes values", async () => {
  const tmp = await makeTempKb();
  try {
    const file = path.join(tmp.dir, ".env");
    await fs.writeFile(
      file,
      ["# a comment", "", "KB_DIR=/tmp/kb", "SITE_TITLE='My KB'", 'PORT="25250"', "not a setting"].join("\n")
    );
    assert.deepEqual(readEnvFile(file), { KB_DIR: "/tmp/kb", SITE_TITLE: "My KB", PORT: "25250" });
  } finally {
    await tmp.cleanup();
  }
});

test("readEnvFile reads a missing file as no settings", () => {
  assert.deepEqual(readEnvFile(path.join("/nonexistent", "kb25", ".env")), {});
});

test("loadEnvFile keeps a variable that is already set", async () => {
  const tmp = await makeTempKb();
  try {
    const file = path.join(tmp.dir, ".env");
    await fs.writeFile(file, "KB25_ENV_FILE_TEST_A=file\nKB25_ENV_FILE_TEST_B=file\n");
    process.env.KB25_ENV_FILE_TEST_A = "env";
    delete process.env.KB25_ENV_FILE_TEST_B;
    loadEnvFile(file);
    assert.equal(process.env.KB25_ENV_FILE_TEST_A, "env");
    assert.equal(process.env.KB25_ENV_FILE_TEST_B, "file");
  } finally {
    delete process.env.KB25_ENV_FILE_TEST_A;
    delete process.env.KB25_ENV_FILE_TEST_B;
    await tmp.cleanup();
  }
});
