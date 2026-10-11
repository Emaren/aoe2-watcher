"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");

test("macOS installs the native system picker before Watcher boot", () => {
  assert.match(main, /setDisplayMediaRequestHandler\(/);
  assert.match(main, /useSystemPicker:\s*true/);
  assert.match(main, /if \(process\.platform !== "darwin"\) return;/);
  assert.match(main, /if \(!request\?\.userGesture/);
  assert.ok(main.indexOf("installMacDisplayPicker();") < main.indexOf("bootWatcherApp();"));
});

test("macOS picker can replace failed source enumeration only by manual user action", () => {
  assert.match(renderer, /const useMacPicker = isMacPlatform\(\) && !autoStarted && sources\.length === 0/);
  assert.match(renderer, /typeof navigator\.mediaDevices\?\.getDisplayMedia === "function"/);
  assert.match(renderer, /const capture = useMacPicker\s*\? await navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(renderer, /: await navigator\.mediaDevices\.getUserMedia/);
  assert.match(renderer, /if \(sources\.length === 0 && !useMacPicker\)/);
});

test("picker fallback cannot request system audio or impersonate a real desktop source", () => {
  assert.match(renderer, /id: "macos-system-picker", name: "macOS selected capture", kind: "screen"/);
  assert.match(renderer, /getDisplayMedia\(\{\s*audio: false,/);
  assert.match(main, /!request\?\.videoRequested/);
  assert.match(main, /request\.frame !== mainWindow\?\.webContents\?\.mainFrame/);
});

test("recorder still uses canonical stream registration and does not modify replay monitoring", () => {
  assert.match(renderer, /streamJson\("\/api\/streams\/start",/);
  assert.match(renderer, /const recorder = new MediaRecorder\(capture,/);
  assert.match(renderer, /queueNativeChunkUpload\(stream\.id, sequence, event\.data\)/);
  assert.match(renderer, /macOS screen sharing was cancelled/);
});

test("Streamer cannot silently start an unlinked video feed before a match is known", () => {
  assert.match(renderer, /if \(!hasStreamCandidate\(\)\) \{\s*handleNativeStreamError\(/);
  assert.match(renderer, /Start Watching to identify your match first/);
  assert.match(renderer, /nativeStreamState\.status === "live" \|\| !hasWatcherKey\(\) \|\| !hasStreamCandidate\(\)/);
  assert.match(renderer, /"Waiting for Match"/);
});
