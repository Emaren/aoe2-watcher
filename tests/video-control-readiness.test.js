const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");

test("watcher main and streamer actions name video explicitly", () => {
  assert.match(html, /id="streamMatchBtn"[^>]*>Stream My Game</);
  assert.match(html, /id="startNativeStreamBtn"[\\s\\S]*?Start Video/);
  assert.match(html, /id="stopNativeStreamBtn"[\\s\\S]*?Stop Video/);
  assert.match(renderer, /"Stream My Game"/);
  assert.match(renderer, /"Pair Watcher to Stream"/);
  assert.match(renderer, /"Video Live"/);
  assert.match(renderer, /"Stop Video"/);
});

test("video remains opt-in and discloses unknown electricity cost", () => {
  assert.match(html, /Video is optional and starts only when you choose it/);
  assert.match(html, /explicitly enable automatic video/);
  assert.match(html, /power cost depends on your PC and is not measured by Watcher/);
  assert.match(html, /id="autoStreamMatchesInput"/);
});

test("stream modes describe codec target, not measured network/power", () => {
  assert.match(renderer, /mode.videoBitsPerSecond \* 3600 \/ 8_000_000_000/);
  assert.match(renderer, /GB\/hour video target \(before overhead\)/);
  assert.match(renderer, /not a network measurement or an electricity estimate/);
  assert.match(renderer, /key: "stable"[\\s\\S]*?videoBitsPerSecond: 1400000/);
  assert.match(renderer, /key: "sharp"[\\s\\S]*?videoBitsPerSecond: 2600000/);
});

test("both video entry points use the same native capture function", () => {
  assert.match(renderer, /els.streamMatchBtn.addEventListener\("click", async \(\) => \{\s*await startNativeStream\(\)/);
  assert.match(renderer, /els.startNativeStreamBtn.addEventListener\("click", \(\) => \{\s*startNativeStream\(\)/);
});
