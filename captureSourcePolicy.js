"use strict";

// This is *capture source selection*, not proof of an AoE2 game or a user's
// authority to broadcast. A Wine/CrossOver app is often represented as a
// wrapper window, even when the running game isn't separately enumerated.
// Never silently stream the browser, the Watcher UI, or an arbitrary window.
// A user-selected source is always honored while that exact source exists.

function isExcludedFromAutomaticCapture(name) {
  const value = String(name || "").toLowerCase();
  return /\b(chrome|firefox|safari|brave|opera|edge|electron helper|watcher|chatgpt)\b/.test(value) ||
    value.includes("aoe2war") || value.includes("aoe2hdbets") ||
    value.includes("screen & system audio recording");
}

function isRecognizedGameWindow(name) {
  const value = String(name || "").toLowerCase();
  if (isExcludedFromAutomaticCapture(value)) return false;
  return /age of empires\s*(?:ii|2)\b|age2hd|aok hd|age of kings|\baoe2(?:\s*hd)?\b/.test(value);
}

function chooseCaptureSource(sources, { platform = "", explicitSourceId = "", preferredKind = "" } = {}) {
  const options = Array.isArray(sources)
    ? sources.filter((source) => source && typeof source.id === "string" &&
        (source.kind === "screen" || source.kind === "window"))
    : [];
  if (explicitSourceId) {
    const chosen = options.find((source) => source.id === explicitSourceId);
    if (chosen) return { source: chosen, authority: "user_selected" };
    // Never silently substitute a different monitor when an explicitly
    // selected display disconnects or changes identity.
    return { source: null, authority: "selected_source_unavailable" };
  }

  const screen = options.find((source) => source.kind === "screen");
  // Full-screen Wine/CrossOver games can replace their native window during
  // play; a named game window is not guaranteed to survive that transition.
  if (platform === "darwin" && preferredKind === "screen" && screen) {
    return { source: screen, authority: "mac_fullscreen_display" };
  }
  const games = options.filter((source) =>
    source.kind === "window" && isRecognizedGameWindow(source.name)
  );
  if (games.length > 0) {
    return { source: games[0], authority: "recognized_game_window" };
  }
  // When macOS only exposes Wine/CrossOver wrapper windows, displaying the
  // actual game frame requires explicit full-display capture. This source is
  // chosen for an explicit "Stream My Game" click or an already opted-in
  // automatic-stream flow; macOS recording consent is still required.
  if (platform === "darwin" && screen) {
    return { source: screen, authority: "mac_display_fallback" };
  }
  if (preferredKind === "screen" && screen) {
    return { source: screen, authority: "fullscreen_mode" };
  }
  return { source: null, authority: "manual_source_required" };
}

const captureSourcePolicy = Object.freeze({
  chooseCaptureSource,
  isExcludedFromAutomaticCapture,
  isRecognizedGameWindow,
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = captureSourcePolicy;
}
if (typeof window !== "undefined") {
  window.WatcherCaptureSourcePolicy = captureSourcePolicy;
}
