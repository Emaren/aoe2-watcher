"use strict";

// Diagnostic journal settings are non-financial and replay-independent,
// but must never defeat their bounded-memory or disk-rotation guarantees.
function boundedDiagnosticBytes(raw, { fallback, minimum, maximum }) {
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 1 ||
    fallback < minimum ||
    maximum < fallback
  ) throw new TypeError("invalid diagnostic byte-limit policy");
  if (
    raw === undefined || raw === null ||
    (typeof raw === "string" && !raw.trim())
  ) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
module.exports = { boundedDiagnosticBytes };
