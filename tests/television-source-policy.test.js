"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  isIdentifiableAoE2WindowName,
  isSafeAutomaticSource,
  selectAutomaticSource,
} = require("../televisionCapturePolicy");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const win = (id, name, score = 0) => ({ id: "window:" + id, kind: "window", name, score });
const screen = (name = "Entire Screen") => ({ id: "screen:0:0", kind: "screen", name, score: 800 });

test("recognized AoE2 HD game executables are accepted on Windows", () => {
  for (const title of [
    "Age of Empires II HD",
    "Age of Empires 2 HD",
    "AoE2 HD",
    "AoE2HD",
    "Age2HD.exe",
    "AoK HD.exe",
    "Age of Kings",
  ]) {
    assert.equal(isIdentifiableAoE2WindowName(title), true, title);
  }
});

test("browser, desktop and generic launcher windows cannot become automatic camera", () => {
  for (const title of [
    "Google Chrome - Age of Empires 2",
    "Age of Empires II HD - aoe2war.com - Microsoft Edge",
    "AoE2HDBets Watcher",
    "Steam",
    "Steam - Library",
    "CrossOver",
    "OBS Studio Age of Empires II",
    "Task Manager",
    "Discord - AoE2 HD",
    "Windows Explorer - Age2HD.exe",
  ]) {
    assert.equal(isIdentifiableAoE2WindowName(title), false, title);
  }
  assert.equal(isSafeAutomaticSource(screen("Age of Empires II HD")), false);
  assert.equal(isSafeAutomaticSource({ ...win("1", "AoE2 HD"), kind: "screen" }), false);
  assert.equal(isSafeAutomaticSource({ ...win("1", "AoE2 HD"), id: "fake:1" }), false);
});

test("automatic director selects only game windows regardless of unsafe source priority", () => {
  const sources = [screen(), win("browser", "Chrome - AoE2 HD", 900),
    win("game", "Age of Empires II HD", 400), win("game2", "Age2HD.exe", 300)];
  assert.equal(selectAutomaticSource(sources)?.id, "window:game");
  assert.equal(selectAutomaticSource(sources, "window:game2")?.id, "window:game2");
  assert.equal(selectAutomaticSource(sources, "screen:0:0")?.id, "window:game");
  assert.equal(selectAutomaticSource([screen(), win("other", "Steam")]), null);
  assert.equal(selectAutomaticSource(null), null);
  assert.equal(selectAutomaticSource([]), null);
});

test("automatic match capture re-scans sources and fails closed before MediaRecorder", () => {
  assert.match(html, /<script src="\.\/televisionCapturePolicy\.js"><\/script>[\s\S]*?<script src="\.\/renderer\.js"><\/script>/);
  assert.match(renderer, /if \(autoStarted \|\| sources\.length === 0\)/);
  assert.match(renderer, /window\.televisionCapturePolicy\?\.selectAutomaticSource/);
  assert.match(renderer, /auto_capture_no_verified_game_window/);
  assert.match(renderer, /Privacy guard: browser, desktop, Steam launcher/);
  assert.match(renderer, /: pickNativeStreamSource\(sources, nativeStreamState\.selectedSourceId, mode\)/);
  assert.match(main, /require\("\.\/televisionCapturePolicy"\)/);
  assert.match(main, /return isIdentifiableAoE2WindowName\(value\)/);
  const guard = renderer.indexOf("if (autoStarted && !selectedSource)");
  const request = renderer.indexOf("navigator.mediaDevices.getUserMedia(", guard);
  assert.ok(guard > 0 && request > guard, "No capture request may precede the automatic source guard.");
});

test("failed opt-in stream re-arms after true match-final evidence, never by upload timeout", () => {
  const seam = renderer.slice(renderer.indexOf("async function endNativeStream("),
    renderer.indexOf("function setReplayVideoPriority("));
  assert.match(seam, /const completedAutoMatch = nativeStreamState\.autoStarted/);
  assert.match(seam, /reason === "match_result_ready" \|\| reason === "match_observation_complete"/);
  assert.match(seam, /const preserveIssue = reason !== "manual" && !completedAutoMatch/);
  assert.match(seam, /autoStarted: false/);
  const controller = renderer.slice(renderer.indexOf("async function manageAutomaticNativeStream("),
    renderer.indexOf("function syncStreamCandidateFromRuntimeEvent("));
  assert.match(controller, /AUTO_STREAM_STOP_RUNTIME_EVENTS\.has\(event\.type\)/);
  assert.match(controller, /event\.resultReady === true/);
  assert.doesNotMatch(controller, /final-candidate-accepted/);
});
