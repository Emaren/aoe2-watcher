"use strict";

// Dedicated desktop diagnostic/watchdog timer policy. This module is NOT a
// change to runtimePolicy.js, whose replay core bytes are frozen to v1.6.5.
const MAX_NODE_TIMER_MS = 2_147_483_647;

function boundedBackgroundIntervalMs(
  raw,
  { fallback, minimum, maximum = MAX_NODE_TIMER_MS }
) {
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 1 ||
    fallback < minimum ||
    maximum < fallback ||
    maximum > MAX_NODE_TIMER_MS
  ) {
    throw new TypeError("invalid background timer policy");
  }
  if (
    raw === undefined || raw === null ||
    (typeof raw === "string" && !raw.trim())
  ) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

// A literal numeric zero intentionally disables periodic telemetry.
// All other malformed or tiny settings fail safe to bounded intervals.
function boundedTelemetryHeartbeatMs(raw) {
  if (raw === 0 || (typeof raw === "string" &&
    raw.trim() !== "" && Number(raw) === 0)) return 0;
  return boundedBackgroundIntervalMs(raw, {
    fallback: 60_000,
    minimum: 10_000,
    maximum: 3_600_000,
  });
}

module.exports = { boundedBackgroundIntervalMs, boundedTelemetryHeartbeatMs };
