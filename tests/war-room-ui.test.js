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

test("second video preview is detached away from visible Broadcast view", () => {
  assert.match(controller, /theme === "war-room" && tab === "broadcast"/);
  assert.match(controller, /mirror\.srcObject = media/);
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
