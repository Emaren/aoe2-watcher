"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  chooseCaptureSource,
  isRecognizedGameWindow,
  isExcludedFromAutomaticCapture,
} = require("../captureSourcePolicy");

const screen = (id = "screen:0:0") => ({ id, name: "Entire screen", kind: "screen" });
const window = (id, name) => ({ id, name, kind: "window" });
const sources = [
  window("window:10", "Google Chrome — aoe2war.com"),
  window("window:11", "CrossOver"),
  window("window:12", "Steam"),
  screen(),
];

test("macOS Full Screen mode uses display rather than Wine/CrossOver wrappers", () => {
  const x = chooseCaptureSource(sources, { platform: "darwin", preferredKind: "screen" });
  assert.equal(x.source.id, "screen:0:0");
  assert.equal(x.authority, "mac_fullscreen_display");
});
test("Mac fallback selects a display when the game window is not natively exposed", () => {
  const x = chooseCaptureSource(sources, { platform: "darwin", preferredKind: "window" });
  assert.equal(x.source.id, "screen:0:0");
  assert.equal(x.authority, "mac_display_fallback");
});
test("named game windows win when full screen isn't preferred", () => {
  const x = chooseCaptureSource([window("window:42", "Age of Empires II HD"), ...sources], {
    platform: "darwin", preferredKind: "window",
  });
  assert.equal(x.source.id, "window:42");
  assert.equal(x.authority, "recognized_game_window");
});
test("Mac Full Screen keeps its display even if Wine exposes a temporary game window", () => {
  const x = chooseCaptureSource([window("window:42", "Age2HD.exe"), ...sources], {
    platform: "darwin", preferredKind: "screen",
  });
  assert.equal(x.source.id, "screen:0:0");
});
test("explicit choice beats recommended mode and heuristic", () => {
  const x = chooseCaptureSource([window("window:42", "Age of Empires II"), ...sources], {
    platform: "darwin", preferredKind: "screen", explicitSourceId: "window:42",
  });
  assert.equal(x.source.id, "window:42");
  assert.equal(x.authority, "user_selected");
});
test("disconnected user-selected display never switches silently to another screen", () => {
  const x = chooseCaptureSource([screen("screen:2:0")], {
    platform: "darwin", preferredKind: "screen", explicitSourceId: "screen:0:0",
  });
  assert.equal(x.source, null);
  assert.equal(x.authority, "selected_source_unavailable");
});
test("never automatically capture a random Windows app, Chrome, or Watcher", () => {
  const x = chooseCaptureSource([
    window("window:9", "Google Chrome — Age of Empires II live on AoE2WAR"),
    window("window:11", "CrossOver"), window("window:8", "AoE2HDBets Watcher"),
  ], { platform: "win32", preferredKind: "window" });
  assert.equal(x.source, null);
  assert.equal(x.authority, "manual_source_required");
});
test("explicit Full Screen mode can use a Windows display", () => {
  const x = chooseCaptureSource(sources, { platform: "win32", preferredKind: "screen" });
  assert.equal(x.source.id, "screen:0:0");
});
test("no identifiable game or Mac display triggers actionable choice, not arbitrary sharing", () => {
  assert.equal(chooseCaptureSource([window("window:11", "CrossOver")], {
    platform: "darwin", preferredKind: "screen",
  }).source, null);
  assert.equal(chooseCaptureSource([], { platform: "darwin" }).source, null);
});
test("recognized game and browser identities are distinct", () => {
  assert.equal(isRecognizedGameWindow("Age of Empires II: HD Edition"), true);
  assert.equal(isRecognizedGameWindow("AoE2WAR — Age of Empires II stream"), false);
  assert.equal(isExcludedFromAutomaticCapture("AoE2HDBets Watcher"), true);
});
test("isolated browser wiring and packaging prevent missing source-policy regressions", () => {
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const pkg = require("../package.json");
  assert.ok(html.indexOf("./captureSourcePolicy.js") < html.indexOf("./renderer.js"));
  assert.ok(html.includes('./captureSourcePolicy.js'));
  assert.match(renderer, /WatcherCaptureSourcePolicy\.chooseCaptureSource/);
  assert.match(renderer, /userSelectedSourceId: els\.streamSourceSelect\.value/);
  assert.match(renderer, /explicitSourceId/);
  assert.ok(pkg.build.files.includes("captureSourcePolicy.js"));
  assert.match(pkg.scripts.lint, /node --check captureSourcePolicy\.js/);
});

test("multi-monitor CrossOver setups require an explicit display choice", () => {
  const displays = [screen("screen:0:0"), screen("screen:1:0")];
  for (const platform of ["darwin", "win32"]) {
    const x = chooseCaptureSource([window("window:11", "CrossOver"), ...displays], {
      platform, preferredKind: "screen",
    });
    assert.equal(x.source, null);
    assert.equal(x.authority, "display_selection_required");
    const picked = chooseCaptureSource(displays, {
      platform, preferredKind: "screen", explicitSourceId: "screen:1:0",
    });
    assert.equal(picked.source.id, "screen:1:0");
  }
});
