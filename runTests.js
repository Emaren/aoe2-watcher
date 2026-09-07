const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;
const testDir = path.join(root, "tests");

const rootTests = fs
  .readdirSync(root, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".test.js")
  )
  .map((entry) => path.join(root, entry.name));

const nestedTests = fs
  .readdirSync(testDir, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".test.js")
  )
  .map((entry) => path.join(testDir, entry.name));

const testFiles = [
  ...rootTests,
  ...nestedTests,
].sort();

if (testFiles.length === 0) {
  throw new Error("No Watcher test files found.");
}

const result = spawnSync(
  process.execPath,
  ["--test", ...testFiles],
  {
    cwd: root,
    stdio: "inherit",
  }
);

if (result.error) {
  throw result.error;
}

process.exitCode =
  Number.isInteger(result.status)
    ? result.status
    : 1;
