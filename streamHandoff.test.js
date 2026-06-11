const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildStreamHandoff,
  buildStreamSessionKey,
  buildStreamTitle,
  normalizeWebBaseUrl,
  stripReplayExtension,
} = require("./streamHandoff");

test("builds a watcher stream handoff URL from a replay filename", () => {
  const handoff = buildStreamHandoff(
    {
      fileName: "MP Replay v5.8 @2026.06.11 0070540 (1).aoe2record",
    },
    {
      webBaseUrl: "https://aoe2war.com/download",
    }
  );

  assert.equal(handoff.ok, true);
  assert.equal(handoff.webBaseUrl, "https://aoe2war.com");
  assert.equal(handoff.sessionKey, "MP Replay v5.8 @2026.06.11 0070540 (1).aoe2record");
  assert.equal(handoff.title, "MP Replay v5.8 @2026.06.11 0070540 (1)");
  assert.equal(
    handoff.url,
    "https://aoe2war.com/profile?watcher_stream=1&stream_session=MP+Replay+v5.8+%402026.06.11+0070540+%281%29.aoe2record&stream_title=MP+Replay+v5.8+%402026.06.11+0070540+%281%29"
  );
});

test("normalizes bare web hosts and ignores paths", () => {
  assert.equal(normalizeWebBaseUrl("aoe2war.com/profile"), "https://aoe2war.com");
  assert.equal(normalizeWebBaseUrl("http://localhost:3030/download"), "http://localhost:3030");
});

test("prefers explicit stream metadata when present", () => {
  const candidate = {
    streamSession: "session-123",
    streamTitle: "Emaren vs EDU.LOPES",
    fileName: "ignored.aoe2record",
  };

  assert.equal(buildStreamSessionKey(candidate), "session-123");
  assert.equal(buildStreamTitle(candidate), "Emaren vs EDU.LOPES");
});

test("strips known replay extensions for display titles only", () => {
  assert.equal(stripReplayExtension("/tmp/example.mgz"), "example");
  assert.equal(stripReplayExtension("example.txt"), "example.txt");
});
