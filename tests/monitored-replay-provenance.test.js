"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyMonitoredReplayProvenance: classify } = require("../replayProvenancePolicy");

const now = Date.parse("2026-10-16T18:18:00Z");
const sample = [
  ["MP Replay v5.8 @2025.11.29 181650 (4).aoe2record",1764469427865],
  ["MP Replay v5.8 @2025.10.06 074031 (1).aoe2record",1759761931798],
  ["MP Replay v5.8 @2026.01.22 170730 (1).aoe2record",1769131120176],
  ["MP Replay v5.8 @2026.02.26 213413 (5).aoe2record",1772160159478],
  ["MP Replay v5.8 @2025.08.06 175759 (2).aoe2record",1754529133945],
  ["MP Replay v5.8 @2026.03.01 153033 (1).aoe2record",1772397559633],
];

test("all six incident files are historical even if discovered by normal folder monitor", () => {
  for (const [fileName,fileMtimeMs] of sample) {
    const result = classify({fileName,fileMtimeMs,nowMs:now});
    assert.equal(result.provenance, "historical_import", fileName);
  }
});

test("new replay uses normal live-monitor provenance", () => {
  const result = classify({
    fileName:"MP Replay v5.8 @2026.10.16 175000.aoe2record",
    fileMtimeMs:now-20_000,nowMs:now,
  });
  assert.equal(result.provenance,"live_monitor");
});

test("copying old replay today does not grant live provenance", () => {
  assert.equal(classify({
    fileName:sample[0][0],fileMtimeMs:now,nowMs:now,
  }).provenance,"historical_import");
});

test("undated file with original old mtime stays historical", () => {
  assert.equal(classify({
    fileName:"unknown.aoe2record",fileMtimeMs:sample[0][1],nowMs:now,
  }).provenance,"historical_import");
});

test("future-dated original replay cannot claim ordinary live game", () => {
  assert.equal(classify({
    fileName:"MP Replay v5.8 @2028.10.16 180000.aoe2record",
    fileMtimeMs:now,nowMs:now,
  }).provenance,"historical_import");
});

test("live and historical paths preserve uploader metadata and prevent historical live iteration", () => {
  const source=fs.readFileSync(path.join(__dirname,"..","watcher.js"),"utf8");
  assert.match(source,/classifyMonitoredReplayProvenance\(\{/);
  assert.match(source,/watchedProvenance\.provenance === WATCHER_PROVENANCE_LIVE_MONITOR/);
  assert.match(source,/isFinal: true,\s*provenance: watchedProvenance\.provenance,/);
  assert.match(source,/isFinal: false,\s*provenance: watchedProvenance\.provenance,/);
});
