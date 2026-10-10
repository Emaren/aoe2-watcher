"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname,"..","renderer.js"),"utf8");
const start = source.indexOf("function buildNativeSessionKey() {");
const end = source.indexOf("\nfunction buildNativeStreamTitle()", start);
if (start < 0 || end <= start) throw new Error("Native session identity helper missing");
const helper = source.slice(start,end);

function keyFor(candidate) {
  return vm.runInNewContext(helper + "\nbuildNativeSessionKey();", {
    getStreamCandidate: () => candidate,
    appInfo: { sessionId: "run-42" },
    Date,
  });
}

test("Watcher video never publishes local Windows, UNC, Mac, or file URLs as session identities", () => {
  for (const value of [
    "C:\\Users\\Player\\Saved Games\\match.aoe2record",
    "c:/Users/Player/Saved Games/match.mgz",
    "\\\\server\\private\\match.mgz",
    "/Users/player/Saved Games/match.mgz",
    "file:///C:/Users/player/match.mgz",
  ]) {
    assert.equal(keyFor({ sessionKey: value }), "watcher:run-42", value);
  }
  assert.equal(keyFor({ filePath: "C:\\secret\\match.aoe2record" }), "watcher:run-42");
});

test("Watcher keeps exact current replay candidate and refuses time/window name guessing", () => {
  assert.equal(keyFor({ sessionKey:"platform:2389123" }), "platform:2389123");
  assert.equal(keyFor({ fileName:"current-match.aoe2record" }), "current-match.aoe2record");
  assert.equal(keyFor({ sessionKey:"watcher:run-42" }), "watcher:run-42");
  assert.match(source, /sessionKey: buildNativeSessionKey\(\),\s*mediaMimeType:/);
  assert.doesNotMatch(helper, /candidate\?\.filePath \|\|/);
});

test("server replay-final heartbeat terminates only capture, never the replay monitoring authority", () => {
  const heartbeatAt = source.indexOf("async function sendNativeHeartbeat(");
  const next = source.indexOf("\nfunction handleNativeStreamError(", heartbeatAt);
  assert.ok(heartbeatAt > 0 && next > heartbeatAt);
  const heartbeat = source.slice(heartbeatAt,next);
  assert.match(heartbeat, /data\.finality === "replay_final" \|\| data\.stream\?\.status === "ended"/);
  assert.match(heartbeat, /endNativeStream\("server_replay_final", \{ drainUploads: false \}\)/);
  assert.match(heartbeat, /Replay monitoring continues/);
  assert.doesNotMatch(heartbeat, /stopWatching\(|stopCurrentWatcher\(/);
  assert.match(source, /await sendNativeHeartbeat\(stream\.id, "live"\);\s*if \(nativeStreamState\.status !== "live" \|\| nativeStreamEnding\) return/);
});
