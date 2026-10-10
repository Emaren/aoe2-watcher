const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(
  path.join(__dirname, "..", "main.js"),
  "utf8",
);

const rendererSource = fs.readFileSync(
  path.join(__dirname, "..", "renderer.js"),
  "utf8",
);

test("main process gives replay uploads authority over video transport", () => {
  assert.match(
    mainSource,
    /networkPriorityArbiter\s*\.handleReplayEvent\(event\)/,
  );

  assert.match(
    mainSource,
    /networkPriorityArbiter\s*\.isReplayPriorityActive\(\)/,
  );

  assert.match(
    mainSource,
    /signal:\s*controller\.signal/,
  );

  assert.match(
    mainSource,
    /priorityYield:\s*true/,
  );
});

test("renderer invalidates stale video backlog during replay transfer", () => {
  assert.match(
    rendererSource,
    /nativeVideoUploadGeneration \+= 1/,
  );

  assert.match(
    rendererSource,
    /uploadGeneration !==\s*nativeVideoUploadGeneration/,
  );

  assert.match(
    rendererSource,
    /Replay upload has priority\. Skipping video slice\./,
  );

  assert.match(
    rendererSource,
    /nativeStreamState\.recorder\.pause\(\)/,
  );

  assert.match(
    rendererSource,
    /nativeStreamState\.recorder\.resume\(\)/,
  );

  assert.match(
    rendererSource,
    /!replayVideoPriorityActive &&\s*now - nativeStreamLastThumbnailAt/,
  );

  assert.match(
    rendererSource,
    /event\?\.type ===\s*"upload-start"/,
  );

  assert.match(
    rendererSource,
    /event\?\.type ===\s*"upload-retry"/,
  );
});


test("watcher advertises terminal media-shed capability on stream requests", () => {
  assert.match(
    mainSource,
    /"x-aoe2war-stream-capabilities":\s*"server-media-shed-v1"/,
  );
});

test("server media-shed response is terminal before generic chunk failure", () => {
  assert.match(
    mainSource,
    /responseData\?\.code ===\s*"STREAM_MEDIA_SHED"/,
  );
  assert.match(
    mainSource,
    /terminalMediaShed:\s*true/,
  );

  const terminalOffset = rendererSource.indexOf("result?.terminalMediaShed");
  const genericFailureOffset = rendererSource.indexOf("if (!result?.ok)", terminalOffset);
  assert.ok(terminalOffset >= 0);
  assert.ok(genericFailureOffset > terminalOffset);
  assert.match(
    rendererSource,
    /await endNativeStream\(\s*"server_media_shed",\s*\{ drainUploads: false \}\s*\)/,
  );
  assert.match(
    rendererSource,
    /Video stopped to protect replay and API traffic\./,
  );
});

test("video quota and pre-ended streams are terminal, never retried as transient failures", () => {
  assert.match(mainSource, /"STREAM_STORAGE_LIMIT", "STREAM_CHUNK_TOO_LARGE"/);
  assert.match(mainSource, /responseData\?\.code === "STREAM_ALREADY_ENDED"/);
  assert.match(mainSource, /terminalStreamStop: true/);
  assert.match(rendererSource, /result\?\.terminalStreamStop \|\| result\?\.data\?\.finality === "replay_final"/);
  assert.match(rendererSource, /"Video storage limit reached; game monitoring continues\."/);
  assert.match(rendererSource, /await endNativeStream\(\s*replayFinal \? "match_result_ready" : "server_terminal_video"/);
  const terminalAt = rendererSource.indexOf("if (result?.terminalStreamStop");
  const retryAt = rendererSource.indexOf("if (!result?.ok)", terminalAt);
  assert.ok(terminalAt >= 0 && retryAt > terminalAt);
  assert.match(rendererSource, /\{ drainUploads: false \}/);
});

test("terminal media quota or shed does not auto-restart another recorder for same match", () => {
  assert.match(rendererSource, /let autoNativeTerminalSuppressedSessionKey = null/);
  assert.match(rendererSource, /if \(nativeStreamState\.autoStarted && result\?\.terminalStreamStop\)/);
  assert.match(rendererSource, /if \(result\?\.terminalMediaShed\) \{/);
  assert.match(rendererSource, /autoNativeTerminalSuppressedSessionKey = buildNativeSessionKey\(\)/);
  assert.match(rendererSource, /if \(autoNativeTerminalSuppressedSessionKey === buildNativeSessionKey\(\)\) return/);
  assert.match(rendererSource, /if \(shouldStop\) autoNativeTerminalSuppressedSessionKey = null/);
});

test("unsupported codec and oversized chunks are terminal video-only, not endless replay queue retries", () => {
  assert.match(mainSource, /STREAM_CHUNK_TOO_LARGE/);
  assert.match(mainSource, /STREAM_FORMAT_UNSUPPORTED/);
  assert.match(mainSource, /terminalStreamStop: true/);
  assert.match(rendererSource, /Video bitrate exceeds upload limit; game monitoring continues/);
  assert.match(rendererSource, /Video codec rejected by server; game monitoring continues/);
  assert.match(rendererSource, /await endNativeStream\(/);
  assert.match(rendererSource, /\{ drainUploads: false \}/);
});
