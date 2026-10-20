"use strict";

// A 2xx response means HTTP transport worked, not that telemetry was stored.
// The AoE2WAR event endpoint returns { ok, stored, suppressed, failed }.
// A single event is successful only when it was stored or deliberately
// coalesced by the server. Never treat failed>0 as a delivery receipt.
// Legacy gateways that return only {ok:true} are accepted to preserve
// compatibility, but do not confer a measured persistence guarantee.
function classifyWatcherTelemetryAck(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "missing_acknowledgment" };
  }
  if (value.ok !== true) {
    return { ok: false, reason: "negative_acknowledgment" };
  }
  const keys = ["stored", "suppressed", "failed"];
  const present = keys.filter(key => Object.hasOwn(value, key));
  if (present.length === 0) {
    return { ok: true, reason: "legacy_transport_acknowledgment" };
  }
  if (present.length !== keys.length ||
      !keys.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) {
    return { ok: false, reason: "malformed_acknowledgment" };
  }
  if (value.failed > 0) {
    return { ok: false, reason: "server_storage_failure" };
  }
  if (value.stored + value.suppressed !== 1) {
    return { ok: false, reason: "unexpected_acknowledgment_count" };
  }
  return { ok: true, reason: value.stored === 1 ? "stored" : "coalesced" };
}

function assertWatcherTelemetryAck(value) {
  const receipt = classifyWatcherTelemetryAck(value);
  if (!receipt.ok) {
    const error = new Error("Watcher telemetry not acknowledged: " + receipt.reason);
    error.code = "AOE2_TELEMETRY_ACK_UNCERTAIN";
    error.watcherTelemetryAckRetryable = true;
    throw error;
  }
  return receipt;
}

module.exports = { classifyWatcherTelemetryAck, assertWatcherTelemetryAck };
