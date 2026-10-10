"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const start = main.indexOf("async function postStreamChunk(");
const stop = main.indexOf("\nfunction isBrowserOrAoE2WarCaptureName(", start);
assert.ok(start > 0 && stop > start, "chunk bridge must exist");
const nativeBridge = main.slice(start, stop);

function makeBridge(outcome) {
  let inflight = 0;
  const events = [];
  const ctx = {
    updateHandoffActive: false, Buffer, AbortController, Number, String, Error,
    loadConfig: () => ({}),
    getStreamWebBaseUrl: () => "https://aoe2war.com",
    normalizeBaseUrl: x => x,
    getSafeStreamApiPath: x => x,
    streamRequestHeaders: (_config, headers) => headers,
    syncAutoInstallOnQuit: () => {},
    maybeInstallPendingWatcherUpdate: () => {},
    resourceProfiler: { recordNetworkBytes: () => {} },
    networkPriorityArbiter: {
      isReplayPriorityActive: () => false,
      registerStreamUpload: () => true,
      unregisterStreamUpload: () => {},
    },
    axios: { post: async () => {
      if (outcome instanceof Error) throw outcome;
      return { status: 200, data: outcome };
    } },
    nativeStreamRequestsInFlight: inflight,
  };
  const post = vm.runInNewContext(nativeBridge + "\npostStreamChunk", ctx);
  return { post, ctx, events };
}
function httpError(status, data) {
  const e = new Error("response rejected");
  e.response = { status, data };
  return e;
}
const payload = { streamId: 4, sequence: 10, bytes: Buffer.from("webm"), mimeType: "video/webm" };

test("quota/oversized/format/end responses are terminal video-only, not network retries", async () => {
  for (const [status, code] of [
    [413, "STREAM_STORAGE_LIMIT"], [413, "STREAM_CHUNK_TOO_LARGE"],
    [415, "STREAM_FORMAT_UNSUPPORTED"], [409, "STREAM_ALREADY_ENDED"],
  ]) {
    const h = makeBridge(httpError(status, { code, terminal: true }));
    const result = await h.post(payload);
    assert.equal(result.terminalVideoStop, true, code);
    assert.equal(result.reason, code);
    assert.equal(h.ctx.nativeStreamRequestsInFlight, 0);
  }
});
test("operator media shed retains its existing terminal backpressure contract", async () => {
  const h = makeBridge(httpError(409, { code:"STREAM_MEDIA_SHED",terminal:true,reason:"high_load",retryAfterSeconds:12 }));
  const result = await h.post(payload);
  assert.equal(result.terminalMediaShed, true);
  assert.equal(result.reason, "high_load");
});
test("temporary 503 is never misclassified as terminal and may retry safely", async () => {
  const h = makeBridge(httpError(503, { code:"TEMPORARY",terminal:false }));
  await assert.rejects(h.post(payload), /response rejected/);
  assert.equal(h.ctx.nativeStreamRequestsInFlight, 0);
});
test("replay-final HTTP 200 stays a finality response and not a false new chunk receipt", async () => {
  const h = makeBridge({ finality:"replay_final",stream:{status:"ended"} });
  const response = await h.post(payload);
  assert.equal(response.ok, true);
  assert.equal(response.data.finality, "replay_final");
});
test("renderer stops repeated failed video and handles ended-heartbeat 409 explicitly", () => {
  assert.match(renderer, /result\?\.terminalVideoStop/);
  assert.match(renderer, /endNativeStream\("server_video_terminal", \{ drainUploads: false \}\)/);
  assert.match(renderer, /options\.allowEndedStream && result\?\.status === 409/);
  assert.match(renderer, /allowEndedStream: true/);
  assert.match(renderer, /failures >= 5 && nativeStreamState\.stream\?\.id === streamId/);
  assert.match(renderer, /endNativeStream\("repeated_video_upload_failure", \{ drainUploads: false \}\)/);
});
