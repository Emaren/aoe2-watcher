"use strict";

// Deliberately bounded to runtime events accepted by the certified
// AoE2WAR /api/watcher/events contract (app-prodn ea8055c4, Oct 10 2026).
// Local-only lifecycle events still enter the local runtime journal and UI;
// they must not become invalid HTTP 400 telemetry or durable-queue churn.
// Explicit emission of auth, stream, and updater telemetry is handled by
// existing call sites and is not restricted by this runtime-only admission.
const ACCEPTED_RUNTIME_EVENTS = Object.freeze([
  "batch_upload_failed",
  "batch_upload_finished",
  "batch_upload_scanned",
  "batch_upload_started",
  "file_size_progress",
  "final_candidate_deferred",
  "final_candidate_ready",
  "final_candidate_reopened",
  "final_result_review_observation_complete",
  "final_settle_observation_complete",
  "final_settle_observation_started",
  "monitor_skip_final",
  "monitor_start",
  "monitor_stop",
  "parse_result_unknown_fields",
  "replay_detected_ignored",
  "skip_already_finalized",
  "skip_file_missing",
  "skip_file_too_small",
  "skip_unknown",
  "skip_upload_in_progress",
  "upload_retry",
  "waiting_for_minimum_size",
  "watcher_error",
  "watcher_ready",
  "watching_started",
  "watching_stopped",
]);

const accepted = new Set(ACCEPTED_RUNTIME_EVENTS);

function isAcceptedRuntimeTelemetryType(value) {
  return typeof value === "string" && accepted.has(value);
}

module.exports = { ACCEPTED_RUNTIME_EVENTS, isAcceptedRuntimeTelemetryType };
