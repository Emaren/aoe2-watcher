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

module.exports = { boundedBackgroundIntervalMs };
