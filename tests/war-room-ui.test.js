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

test("unavailable player stats stay blank; future auth must come through approved IPC", () => {
  assert.match(controller, /Awaiting verified player statistics/);
  assert.match(controller, /Player profile awaiting verification/);
  assert.match(controller, /renderPlayerSummary\(null\)/);
  assert.match(controller, /typeof bridge\.onPlayerSummary === "function"/);
  assert.doesNotMatch(controller, /fetch\s*\(/);
  assert.match(controller, /does not guess a winner/);
  assert.match(controller, /https:\/\/aoe2war\.com\/profile/);
});

test("War Room assets are packaged and controls remain accessible", () => {
  assert.ok(manifest.build.files.includes("war-room-player.js"));
  assert.ok(manifest.build.files.includes("war-room.js"));
  assert.ok(manifest.build.files.includes("war-room.css"));
  assert.match(manifest.scripts.lint, /node --check war-room\.js/);
  assert.match(html, /src="\.\/war-room-player\.js"/);
  assert.ok(html.indexOf('src="./war-room-player.js"') < html.indexOf('src="./war-room.js"'));
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
  assert.match(controller, /id="wr-overview-airtime"/);
  assert.match(controller, /id="wr-overview-streams"/);
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
  assert.match(controller, /const syncInitialStatus = \(\) => paintReadiness\(\)/);
  assert.doesNotMatch(controller, /bridge\.startWatching\s*\(/);
  assert.doesNotMatch(controller, /bridge\.stopWatching\s*\(/);
});

test("quality selection is observed from Classic without adding a second source policy", () => {
  assert.match(controller, /classic\.querySelectorAll\("\[data-stream-mode\]"\)/);
  assert.match(controller, /attributeFilter: \["class", "disabled"\]/);
  assert.match(controller, /if \(theme !== "war-room"\) return/);
  assert.doesNotMatch(controller, /new DesktopCapturer/);
});

test("existing video preview is reparented, not cloned or re-recorded", () => {
  assert.match(controller, /previewVideo\?\.parentNode/);
  assert.match(controller, /previewVideo\?\.nextSibling/);
  assert.match(controller, /classicVideo\.parentNode !== destination/);
  assert.match(controller, /previewSlot\.appendChild\(classicVideo\)/);
  assert.match(controller, /previewHome\.insertBefore/);
  assert.doesNotMatch(controller, /\.cloneNode\(/);
  assert.doesNotMatch(controller, /new MediaRecorder/);
  assert.match(styles, /\.wr-preview-slot>\.stream-preview\[hidden\]/);
});

test("War Room uses validated replay-directory truth, not just a saved path", () => {
  assert.match(controller, /classicFolder === "Folder ready"/);
  assert.match(controller, /classicFolder === "Folder missing"/);
  assert.match(controller, /new MutationObserver\(paintReadiness\)\.observe\(classicFolder/);
  assert.doesNotMatch(controller, /folderReady = Boolean\(config\.watchDir\)/);
  assert.match(controller, /Valid replay folder/);
});

test("key presence never claims authenticated player identity", () => {
  assert.match(controller, /Watcher key configured/);
  assert.match(controller, /Player identity requires server verification/);
  assert.doesNotMatch(controller, /write\("wr-paired", paired \? "Profile paired"/);
});

test("process CPU trend deduplicates repeated app-info snapshots by sampledAt", () => {
  assert.match(controller, /lastResourceSampleEpoch = Number\.NEGATIVE_INFINITY/);
  assert.match(controller, /typeof profile\.sampledAt === "string"/);
  assert.match(controller, /Number\.isFinite\(sampleEpoch\)/);
  assert.match(controller, /sampleEpoch <= lastResourceSampleEpoch/);
  assert.match(controller, /cpuSamples\.push\(cpu\)/);
});

test("Watcher error and import states come from Classic instead of unconditional green", () => {
  assert.match(controller, /hasClassicStatus \? oldStatus/);
  assert.match(controller, /oldStatus === "Watching for new replays"/);
  assert.match(controller, /statusDetail = hasClassicStatus \? oldDetail/);
});

test("Old Blue (Classic) source markup matches the immutable 1.6.5 parent", () => {
  // The shell ID is deliberately new; everything INSIDE it is original.
  // SHA-256 from 2b1d2a0e3973a937c6f57bdebdace47cc1684b4f.
  // Git Windows checkouts may change LF to CRLF; normalize EOL only.
  const crypto = require("node:crypto");
  const body = html.match(/<main class="shell" id="oldBlueShell">([\s\S]*?)<\/main>/);
  assert.ok(body, "Original blue shell must remain mounted");
  assert.equal(
    crypto.createHash("sha256").update(body[1].replace(/\r\n/g, "\n"), "utf8").digest("hex"),
    "831babc3ac27ae393415a73492f45a1e52d1e2f46d7a0df716912035ca07642d",
    "Old Blue markup drifted from the 1.6.5 parent; review separately"
  );
});

test("Old Blue (Classic) stylesheet remains byte-identical to original", () => {
  const crypto = require("node:crypto");
  const style = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(style, "Original style block must remain present");
  assert.equal(
    crypto.createHash("sha256").update(style[1].replace(/\r\n/g, "\n"), "utf8").digest("hex"),
    "4c2f44247da2bd73acf14020b939f0e12c216b8c161781164a31cbf72a4af2a0",
    "Old Blue styling drifted from the 1.6.5 parent; review separately"
  );
});

test("command post never announces ready when credentials, directory, or Watcher are not", () => {
  assert.match(controller, /id="wr-hero-headline"/);
  assert.match(controller, /const readyToPlay = paired && folderReady/);
  assert.match(controller, /const needsAttention = \/issue\|error\|attention\|failed\|missing\|retrying/i);
  assert.match(controller, /"Finish setup"/);
  assert.match(controller, /"Attention needed"/);
  assert.match(controller, /"Preparing command post…"/);
});

test("systems telemetry reuses existing genuine process metrics only", () => {
  assert.match(controller, /id="wr-sys-network"/);
  assert.match(controller, /id="wr-sys-wakeups"/);
  assert.match(controller, /typeof profile\.networkMbps === "number"/);
  assert.match(controller, /profile\.idleWakeupsAvailable === true/);
  assert.match(controller, /id="wr-sys-wakeups">Not reported/);
  assert.doesNotMatch(controller, /powerWatts\s*\|\|/);
});

test("player display remains dormant without authorized IPC, keeps rejected values blank", () => {
  assert.match(controller, /typeof bridge\.onPlayerSummary === "function"/);
  assert.match(controller, /renderPlayerSummary\(null\)/);
  assert.match(controller, /const contract = window\.WarRoomPlayer/);
  assert.match(controller, /stream\?\.peakConcurrentViewers \?\? "—"/);
  assert.match(controller, /renderPlayerSummary\(null\);\s*paired = Boolean/);
  assert.doesNotMatch(controller, /fetch\s*\(/);
  assert.ok(manifest.scripts.lint.includes("node --check war-room-player.js"));
});

test("authenticated player summary expires once without background polling", () => {
  assert.match(controller, /playerExpiryTimer = setTimeout/);
  assert.match(controller, /clearTimeout\(playerExpiryTimer\)/);
  assert.match(controller, /playerSummaryGeneration === generation/);
  assert.match(controller, /contract\.MAX_AGE_MS/);
  assert.doesNotMatch(controller, /setInterval\s*\(/);
});
