"use strict";

// A replay discovered by the ordinary folder watcher isn't necessarily live.
// Source-local filename timestamps and original file mtime are *negative*
// evidence: if either proves a historical file, never sign it as live_monitor.
// Nothing here invents or corrects Elo, wins, or actual match chronology.
const GRACE_MS = 48 * 60 * 60 * 1000;
const NAME_CLOCK = /@(\d{4})[._-](\d{2})[._-](\d{2})[\s_-](\d{2})[:._-]?(\d{2})[:._-]?(\d{2})/;

function originalNameClock(fileName) {
  if (typeof fileName !== "string") return null;
  const m = fileName.match(NAME_CLOCK);
  if (!m) return null;
  const [year,month,day,hour,minute,second] = m.slice(1).map(Number);
  const utc = Date.UTC(year,month-1,day,hour,minute,second);
  if (!Number.isFinite(utc)) return null;
  const d = new Date(utc);
  return d.getUTCFullYear() === year && d.getUTCMonth()+1 === month &&
    d.getUTCDate() === day && d.getUTCHours() === hour &&
    d.getUTCMinutes() === minute && d.getUTCSeconds() === second
      ? utc : null;
}

function classifyMonitoredReplayProvenance({
  fileName,
  fileMtimeMs,
  nowMs = Date.now(),
} = {}) {
  const clock = originalNameClock(fileName);
  if (!Number.isFinite(nowMs)) return {provenance: "historical_import", reason: "no_valid_scan_clock"};
  if (clock !== null && Math.abs(nowMs - clock) > GRACE_MS) {
    return {provenance: "historical_import", reason: "old_or_invalid_original_filename_clock"};
  }
  if (Number.isFinite(fileMtimeMs) && fileMtimeMs > 0 &&
      Math.abs(nowMs - fileMtimeMs) > GRACE_MS) {
    return {provenance: "historical_import", reason: "old_or_invalid_original_file_mtime"};
  }
  return {provenance: "live_monitor", reason: "no_historical_contradiction"};
}

module.exports = { classifyMonitoredReplayProvenance };
