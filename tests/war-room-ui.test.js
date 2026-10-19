"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const controller = fs.readFileSync(path.join(root, "war-room.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "war-room.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("Old Blue retains original renderer identities and runtime binding", () => {
  for (const id of [
    "oldBlueShell", "watchDirInput", "uploadApiKeyInput",
    "startWatchingBtn", "stopWatchingBtn", "startNativeStreamBtn",
    "stopNativeStreamBtn", "streamPreview", "scanImportBtn",
    "importRecentList", "resourceCpuText", "copySupportBtn"
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.ok(html.indexOf('src="./renderer.js"') < html.indexOf('src="./war-room.js"'));
  assert.match(html, /id="warRoomHost" hidden/);
});

test("both appearances are selectable without reloading renderer or replacing monitor", () => {
  assert.match(controller, /data-wr-theme="old-blue"/);
  assert.match(controller, /data-wr-theme="war-room"/);
  assert.match(controller, /aria-pressed/);
  assert.match(controller, /localStorage\.setItem/);
  assert.match(controller, /classic\.hidden = next === "war-room"/);
  assert.match(controller, /host\.hidden = next !== "war-room"/);
  assert.doesNotMatch(controller, /location\.(reload|assign|replace)\s*\(/);
  assert.doesNotMatch(controller, /new MediaRecorder\s*\(/);
  assert.doesNotMatch(controller, /new\s+(Worker|WebSocket)\s*\(/);
});

test("War Room uses existing actions and observational IPC; no financial handlers", () => {
  assert.match(controller, /forward\(btn\.dataset\.wrAction\)/);
  assert.match(controller, /button\.click\(\)/);
  assert.match(controller, /bridge\.onResourceProfile/);
  assert.match(controller, /bridge\.onRuntimeEvent/);
  assert.match(controller, /bridge\.onImportState/);
  assert.doesNotMatch(controller, /setInterval\s*\(/);
  assert.doesNotMatch(controller, /fetch\s*\(/);
  assert.doesNotMatch(controller, /war-satchel|auto-bet|signAndBroadcast|settlementExecute/i);
});

test("single existing capture preview returns to Classic without a duplicate decoder", () => {
  assert.match(controller, /theme === "war-room" && tab === "broadcast"/);
  assert.match(controller, /previewSlot\.appendChild\(classicVideo\)/);
  assert.match(controller, /previewHome\.insertBefore\(/);
  assert.match(controller, /const previewVideo = el\("streamPreview"\)/);
  assert.match(controller, /classicVideo\.srcObject/);
  assert.doesNotMatch(controller, /id="wr-preview"/);
  assert.match(styles, /\.wr-preview-slot>\.stream-preview/);
  assert.match(styles, /\.wr-preview-slot>\.stream-preview\[hidden\]/);
  assert.match(controller, /function chooseTab\(next\)/);
  assert.match(controller, /function chooseTheme\(next/);
});

test("unavailable player stats are not fabricated; authentic source remains website", () => {
  assert.match(controller, /Awaiting paired player statistics/);
  assert.match(controller, /Not yet tracked/);
  assert.match(controller, /does not guess a winner/);
  assert.match(controller, /https:\/\/aoe2war\.com\/profile/);
});

test("War Room assets are packaged and controls remain accessible", () => {
  assert.ok(manifest.build.files.includes("war-room.js"));
  assert.ok(manifest.build.files.includes("war-room.css"));
  assert.match(manifest.scripts.lint, /node --check war-room\.js/);
  assert.match(html, /href="\.\/war-room\.css"/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\.app-shell>\.shell\[hidden\]/);
});

test("War Room Broadcast delegates source and quality controls to the original engine", () => {
  assert.match(controller, /data-wr-action="startNativeStreamBtn"/);
  assert.match(controller, /data-wr-action="stopNativeStreamBtn"/);
  assert.match(controller, /data-wr-action="refreshStreamSourcesBtn"/);
  assert.match(controller, /data-wr-mode="stable"/);
  assert.match(controller, /data-wr-mode="screen"/);
  assert.match(controller, /data-wr-mode="sharp"/);
  assert.match(controller, /original\.dispatchEvent\(new Event\("change"/);
  assert.match(controller, /if \(original && !original\.disabled\) original\.click\(\)/);
  assert.match(controller, /button\.disabled = originalButton\.disabled/);
  assert.match(controller, /sourcePicker\.disabled = original\.disabled/);
  assert.match(controller, /syncCaptureControls\(\)/);
  assert.match(styles, /\.wr-select:focus-visible/);
  assert.match(controller, /Full-display capture shares everything visible/);
  assert.doesNotMatch(controller, /getDisplayMedia\s*\(/);
  assert.doesNotMatch(controller, /getUserMedia\s*\(/);
});

test("War Room accessibility includes labelled keyboard tabs and bounded telemetry", () => {
  assert.match(controller, /aria-controls/);
  assert.match(controller, /role", "tabpanel"/);
  assert.match(controller, /role", "tablist"/);
  assert.match(controller, /ArrowLeft/);
  assert.match(controller, /ArrowRight/);
  assert.match(controller, /Home/);
  assert.match(controller, /End/);
  assert.match(controller, /cpuSamples\.length > 40/);
  assert.match(controller, /typeof profile\.cpuPercent === "number"/);
});

test("documentation authority explicitly isolates financial work and supports the theme's provenance", () => {
  const memo = fs.readFileSync(path.join(root, "docs/WATCHER_WAR_ROOM_UI.md"), "utf8");
  const reg = JSON.parse(fs.readFileSync(path.join(root, "docs/document-registry.json"), "utf8"));
  assert.match(memo, /Old Blue \(Classic\)/);
  assert.match(memo, /Auto Bets, War Satchel/);
  assert.match(memo, /duplicated replay watcher/);
  assert.ok(reg.documents.some(entry => entry.path === "docs/WATCHER_WAR_ROOM_UI.md"));
});

test("session activity is observational, never a fabricated lifetime statistic", () => {
  assert.match(controller, /Live starts observed this session/);
  assert.match(controller, /Replay detections this session/);
  assert.match(controller, /observedStreamStarts \+= 1/);
  assert.match(controller, /if \(streamStatusBaselineRead && live && !previousLiveState\)/);
  assert.match(controller, /streamStatusBaselineRead = true/);
  assert.match(controller, /event\.type === "replay-detected"/);
  assert.match(controller, /Verified lifetime airtime/);
  assert.match(controller, /Not yet available/);
});

test("native streaming readouts and import receipts are observed, never promoted to match verdicts", () => {
  assert.match(controller, /id="wr-capture-headline"/);
  assert.match(controller, /id="wr-capture-details"/);
  assert.match(controller, /streamReadoutSummary/);
  assert.match(controller, /streamReadoutDetail/);
  assert.match(controller, /id="wr-import-recent"/);
  assert.match(controller, /Array\.isArray\(state\.recentItems\)/);
  assert.match(controller, /state\.recentItems\.slice\(0, 5\)/);
  assert.match(controller, /item\.fileName \|\| "Replay"/);
  assert.doesNotMatch(controller, /row\.innerHTML\s*=/);
  assert.match(controller, /item\.status/);
  assert.match(controller, /"Sent to review"/);
  assert.match(controller, /"Result ready"/);
  assert.doesNotMatch(controller, /item\.winner/);
});

test("first boot mirrors Classic watcher state without creating another monitoring engine", () => {
  assert.match(controller, /oldStatus === "Watching for new replays"/);
  assert.match(controller, /new MutationObserver\(syncInitialStatus\)/);
  assert.match(controller, /if \(!statusKnown\) paintReadiness\(\)/);
  assert.doesNotMatch(controller, /bridge\.startWatching\s*\(/);
  assert.doesNotMatch(controller, /bridge\.stopWatching\s*\(/);
});
