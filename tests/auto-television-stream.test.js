const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("automatic Television WOLO capture is explicit persistent opt-in", () => {
  assert.match(main, /autoStreamMatches:\s*false/);
  assert.match(renderer, /autoStreamMatches:\s*false/);
  assert.match(html, /id="autoStreamMatchesInput"/);
  assert.match(html, /Automatically stream detected matches to Television WOLO/);
  assert.match(renderer, /autoStreamMatches:\s*Boolean\(els\.autoStreamMatchesInput\?\.checked\)/);
  assert.match(renderer, /els\.autoStreamMatchesInput\.checked = config\.autoStreamMatches === true/);
});

test("detected replay starts native video automatically only after opt-in", () => {
  assert.match(renderer, /AUTO_STREAM_START_RUNTIME_EVENTS = new Set\(\[\s*"replay-detected",\s*"midgame-replay-recovered"/);
  assert.match(renderer, /async function manageAutomaticNativeStream\(event\)/);
  assert.match(renderer, /const autoStreamMatches = Boolean\(readForm\(\)\.autoStreamMatches\)/);
  assert.match(renderer, /await startNativeStream\(\{ auto: true \}\)/);
  assert.match(renderer, /nativeStreamState\.status !== "idle"/);
  assert.match(renderer, /autoNativeStreamStartPending/);
});

test("automatic capture stops from authoritative terminal evidence, not quiet-file guesswork", () => {
  assert.match(renderer, /"final-settle-observation-complete"/);
  assert.match(renderer, /"final-result-review-observation-complete"/);
  assert.match(renderer, /event\.type === "upload-success"/);
  assert.match(renderer, /event\.isFinal === true/);
  assert.match(renderer, /event\.resultReady === true/);
  assert.match(renderer, /nativeStreamState\.autoStarted/);
  assert.match(renderer, /"match_result_ready"/);
  assert.match(renderer, /"match_observation_complete"/);

  const stopSetStart = renderer.indexOf("const AUTO_STREAM_STOP_RUNTIME_EVENTS");
  const stopSetEnd = renderer.indexOf("const STREAM_CHUNK_TIMESLICE_MS", stopSetStart);
  const stopSet = renderer.slice(stopSetStart, stopSetEnd);
  assert.doesNotMatch(stopSet, /final-candidate-accepted/);
});

test("automatic capture stays armed when the dashboard is hidden in tray mode", () => {
  assert.match(main, /runtimeConfig\.autoStreamMatches === true/);
  assert.match(main, /createWindow\(\{ showOnReady: false \}\)/);
  assert.match(main, /Dashboard hidden; automatic Television WOLO capture remains armed\./);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /backgroundThrottling:\s*loadConfig\(\)\.autoStreamMatches !== true/);
  assert.match(main, /setBackgroundThrottling\(\s*saved\.autoStreamMatches !== true/);
});

test("match shutdown drains queued media before the server archives the stream", () => {
  const drainAt = renderer.indexOf("await stopNativeCaptureAndDrainUploads()");
  const uploadDrainAt = renderer.indexOf("await nativeUploadChain.catch", drainAt);
  const serverEndAt = renderer.indexOf("/end", drainAt);
  assert.ok(drainAt >= 0);
  assert.ok(uploadDrainAt > drainAt);
  assert.ok(serverEndAt > uploadDrainAt);
  assert.match(renderer, /recorder\.addEventListener\("stop", finish, \{ once: true \}\)/);
  assert.match(renderer, /nativeStreamEnding/);
  assert.match(renderer, /\{ drainUploads: false \}/);
});

test("manual video controls remain available and replay transport keeps priority", () => {
  assert.match(renderer, /els\.startNativeStreamBtn\.addEventListener/);
  assert.match(renderer, /els\.stopNativeStreamBtn\.addEventListener/);
  assert.match(renderer, /setReplayVideoPriority\(true\)/);
  assert.match(renderer, /Replay upload has priority\. Skipping video slice\./);
});
