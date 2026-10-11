"use strict";

const MAC_SCREEN_SETTINGS = "System Settings > Privacy & Security > Screen & System Audio Recording";
const STATUSES = new Set(["granted", "denied", "restricted", "not-determined", "unknown"]);

function readScreenCapturePermission({ platform = process.platform, preferences } = {}) {
  if (platform !== "darwin") return "not-applicable";
  try {
    const status = preferences?.getMediaAccessStatus?.("screen");
    return STATUSES.has(status) ? status : "unknown";
  } catch {
    // The diagnostic must not break replay capture or source enumeration.
    return "unknown";
  }
}

function describeCaptureSourceFailure(error, permissionStatus = "unknown", platform = process.platform) {
  const raw = String(error?.message || error || "No capture sources returned")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250);
  if (platform !== "darwin") return `Video source discovery failed: ${raw}`;
  if (permissionStatus === "denied" || permissionStatus === "restricted") {
    return `macOS screen recording is ${permissionStatus}. Open ${MAC_SCREEN_SETTINGS}, allow AoE2HDBets Watcher, fully quit and reopen Watcher, then press Sources. Capture error: ${raw}`;
  }
  if (permissionStatus === "not-determined") {
    return `macOS has not yet confirmed screen recording permission. Check ${MAC_SCREEN_SETTINGS}, allow AoE2HDBets Watcher if listed, quit/reopen, then press Sources. Capture error: ${raw}`;
  }
  return `Video source discovery failed (screen permission: ${permissionStatus}). ${raw}. On macOS check ${MAC_SCREEN_SETTINGS} and reopen Watcher; if already enabled, report this exact error.`;
}

module.exports = { MAC_SCREEN_SETTINGS, readScreenCapturePermission, describeCaptureSourceFailure };
