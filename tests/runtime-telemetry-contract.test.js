"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ACCEPTED_RUNTIME_EVENTS, isAcceptedRuntimeTelemetryType } =
  require("../runtimeTelemetryContract");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const pkg = require("../package.json");

test("runtime telemetry admits legitimate monitor, upload and terminal lifecycle events", () => {
  const supported = [
    "monitor_start", "monitor_stop", "upload_retry",
    "final_candidate_ready", "final_candidate_deferred",
    "final_settle_observation_complete", "watcher_ready",
    "watching_started", "replay_detected_ignored", "file_size_progress",
    "batch_upload_finished", "parse_result_unknown_fields",
  ];
  assert.ok(supported.every(isAcceptedRuntimeTelemetryType));
  assert.equal(ACCEPTED_RUNTIME_EVENTS.length, new Set(ACCEPTED_RUNTIME_EVENTS).size);
});

test("runtime internal recovery events never become HTTP 400s", () => {
  for (const name of [
    "settlement_state_restored", "replay_scan_complete",
    "initial_replay_scan_complete", "midgame_replay_recovered",
    "replay_admission_complete", "final_replay_change_recovered",
    "watcher_recovery_scan_error", "watcher_recovery_scan_hit",
    "made_up_future_event", "", null,
  ]) {
    assert.equal(isAcceptedRuntimeTelemetryType(name), false, String(name));
  }
});

test("main gates only normalized fallback, not named API events", () => {
  assert.match(main, /if \(isAcceptedRuntimeTelemetryType\(normalizedType\)\) \{\s*emitWatcherTelemetry\(normalizedType, basePayload\)/);
  assert.match(main, /emitWatcherTelemetry\("upload_succeeded", basePayload\)/);
  assert.match(main, /emitWatcherTelemetry\("replay_detected", basePayload\)/);
  assert.match(main, /emitWatcherTelemetry\("upload_failed", basePayload\)/);
  assert.match(main, /emitWatcherTelemetry\(\s*"heartbeat"/);
});

test("production packages and lints the telemetry contract", () => {
  assert.ok(pkg.build.files.includes("runtimeTelemetryContract.js"));
  assert.match(pkg.scripts.lint, /node --check runtimeTelemetryContract\.js/);
});
