"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const begin = source.indexOf("function safeNativeVideoTelemetry(");
const end = source.indexOf("\nasync function sendNativeStreamEvent(", begin);
assert.ok(begin > 0 && end > begin);
const fn = vm.runInNewContext(source.slice(begin, end) + "\nsafeNativeVideoTelemetry", {
  Set, Object, Number,
});

test("video telemetry keeps bounded useful machine diagnostics", () => {
  const actual = fn({
    streamId: 881, sequence: 34, chunkCount: 35, videoBitrate: 2600000,
    sourceKind: "screen", sourceType: "watcher_native", reason: "volume_reserved_floor",
    uploadQueueLength: 2, lastUploadLatencyMs: 270, thumbnailUpdated: true,
  });
  assert.equal(actual.streamId, 881);
  assert.equal(actual.chunkCount, 35);
  assert.equal(actual.reason, "volume_reserved_floor");
  assert.equal(actual.lastUploadLatencyMs, 270);
  assert.equal(actual.sourceKind, "screen");
  assert.equal(actual.thumbnailUpdated, true);
});
test("window title, screen label, filesystem path and unbounded free text never leave renderer", () => {
  const report = fn({
    title: "Personal bank account",
    sourceName: "Secret document /Users/private/finances",
    trackLabel: "C:\\Users\\Player\\Desktop\\tax-return.pdf",
    sourceId: "window:219:0",
    modeDetail: "Some very private prose",
    captureGuidance: "Open a private browser tab",
    errorMessage: "Could not read C:\\Users\\Private\\folder",
    detail: "/home/player/secret",
    sessionKey: "private-game-file",
    reason: "C:\\Users\\Private\\folder",
    eventName: "secret",
    mode: "sharp",
    uploadFailures: 2,
    elapsedMs: Infinity,
    chunkCount: -3,
    videoBitrate: 10 ** 16,
  });
  assert.deepEqual(Object.keys(report).sort(), ["mode","uploadFailures"]);
});
test("telemetry is guaranteed sanitized at the final outbound serialization boundary", () => {
  const sendAt = source.indexOf("async function sendNativeStreamEvent(");
  const stopAt = source.indexOf("\nasync function refreshNativeStreamSources(", sendAt);
  const outgoing = source.slice(sendAt,stopAt);
  assert.match(outgoing, /metadata: safeNativeVideoTelemetry\(\{/);
  assert.doesNotMatch(outgoing, /title: buildNativeStreamTitle\(\)|sourceName: nativeStreamState.sourceName/);
});
