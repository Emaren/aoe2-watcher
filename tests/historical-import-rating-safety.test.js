"use strict";

// Source-bound regression for the next Watcher integration lane.
// A legitimate replay archive import must never be signed as a live-monitor
// current-account observation. This test guards the real caller and signature
// handoff without performing uploads, opening a game, or importing Electron.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const code = fs.readFileSync(path.join(__dirname, "..", "watcher.js"), "utf8");

test("historical and live provenance constants remain independently typed", () => {
  assert.match(code, /WATCHER_PROVENANCE_LIVE_MONITOR\s*=\s*["']live_monitor["']/);
  assert.match(code, /WATCHER_PROVENANCE_HISTORICAL_IMPORT\s*=\s*["']historical_import["']/);
});

test("the batch-import call always explicitly passes historical_import", () => {
  const at = code.indexOf("async function processHistoricalImport");
  // Match the actual historical-import invocation without requiring its
  // implementation function name, which can change during a refactor.
  const matched = code.match(
    /uploadReplayWithRetry\(candidate\.filePath,\s*runtimeConfig,\s*entry,\s*\{[\s\S]*?provenance:\s*WATCHER_PROVENANCE_HISTORICAL_IMPORT,[\s\S]*?\}\)/,
  );
  assert.ok(matched, "batch upload must explicitly mark historical provenance");
  assert.match(matched[0], /isFinal:\s*true/);
});

test("retry retains provenance all the way to upload metadata and HMAC", () => {
  assert.match(code, /historicalImport\s*=\s*provenance\s*===\s*WATCHER_PROVENANCE_HISTORICAL_IMPORT/);
  assert.match(code, /"x-watcher-provenance":\s*provenance/);
  assert.match(code, /"x-watcher-provenance-signature":\s*signWatcherProvenance\(\{[\s\S]*?provenance,/);
  assert.match(code, /uploadReplay\([\s\S]*?\{[\s\S]*?provenance,[\s\S]*?\}\s*\)/);
});

test("batch success never registers a live-match settlement state", () => {
  assert.match(code, /finalStored\s*&&\s*!historicalImport[\s\S]*?persistSettlementState\(\)/);
});
