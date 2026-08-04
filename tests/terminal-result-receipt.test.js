const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
const watcherSource = fs.readFileSync(path.join(root, "watcher.js"), "utf8");

test("settled replay telemetry preserves the terminal result receipt", () => {
  for (const eventType of [
    "final-settle-observation-started",
    "final-settle-observation-complete",
  ]) {
    assert.match(watcherSource, new RegExp(`\\"${eventType}\\"`));
  }

  for (const metadataField of [
    "finalStored",
    "finalAccepted",
    "settleWindowMs",
    "fingerprint",
    "fileSizeBytes",
    "mtimeMs",
  ]) {
    assert.match(
      mainSource,
      new RegExp(metadataField),
      `${metadataField} must survive into remote telemetry metadata`
    );
  }
});
