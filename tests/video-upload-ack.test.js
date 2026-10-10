"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const start = src.indexOf("async function uploadNativeChunk(");
const stop = src.indexOf("\nfunction queueNativeChunkUpload(", start);
assert.ok(start >= 0 && stop > start, "Native chunk uploader source must be present");
const body = src.slice(start, stop);

function createHarness(result, currentStreamId = 11) {
  const state = {
    stream: { id: currentStreamId, chunkCount: 2 },
    mediaMimeType: "video/webm",
    chunkCount: 2,
    sourceName: "Test game",
    uploadQueueLength: 1,
  };
  const events = [];
  const context = {
    window: { watcherApi: { streamChunk: async () => result } },
    nativeStreamState: state,
    getStreamingBaseUrl: () => "https://aoe2war.com",
    yieldNativeVideoChunk: () => events.push("yield"),
    endNativeStream: async (why, options) => {
      events.push({ end: why, options });
      state.stream = null;
    },
    setNativeReadout: (message) => events.push({ readout: message }),
    updateNativeStreamState: (patch) => Object.assign(state, patch),
    sendNativeStreamEvent: (name) => { events.push({ event: name }); },
    Date, Number, Math, Error,
  };
  const upload = vm.runInNewContext(body + "\nuploadNativeChunk", context);
  const blob = {
    size: 1280,
    type: "video/webm",
    arrayBuffer: async () => new ArrayBuffer(1280),
  };
  return { state, events, send: (id = 11) => upload(id, 3, blob) };
}

test("server replay-final 200 is never reported as a stored WebM chunk", async () => {
  const h = createHarness({ ok: true, data: { finality: "replay_final", stream: { status: "ended" } } });
  await h.send();
  assert.equal(h.state.chunkCount, 2);
  assert.equal(h.events.some(e => e.event === "stream_chunk_uploaded"), false);
  assert.deepEqual(h.events.filter(e => e.end).map(e => e.end), ["server_replay_final"]);
});

test("idempotent duplicate receipt preserves the server's authoritative count", async () => {
  const h = createHarness({ ok: true, data: { chunkCreated: false, stream: { id: 11, status: "live", chunkCount: 2 } } });
  await h.send();
  assert.equal(h.state.chunkCount, 2);
  assert.match(h.state.readout, /already safely stored/);
});

test("created receipt uses the server's actual new count", async () => {
  const h = createHarness({ ok: true, data: { chunkCreated: true, stream: { id: 11, status: "live", chunkCount: 3 } } });
  await h.send();
  assert.equal(h.state.chunkCount, 3);
  assert.match(h.state.readout, /Chunk 3 stored/);
});

test("malformed 200 acknowledgment never fabricates recorded media", async () => {
  const h = createHarness({ ok: true, data: { stream: { id: 11, chunkCount: 3 } } });
  await assert.rejects(h.send(), /acknowledgement was incomplete/);
  assert.equal(h.state.chunkCount, 2);
  assert.equal(h.events.some(e => e.event === "stream_chunk_uploaded"), false);
});

test("response from replaced stream cannot end or rewrite new broadcaster", async () => {
  const h = createHarness({ ok: true, data: { finality: "replay_final", stream: { status: "ended" } } }, 99);
  await h.send(11);
  assert.equal(h.state.stream.id, 99);
  assert.equal(h.events.filter(e => e.end).length, 0);
});
