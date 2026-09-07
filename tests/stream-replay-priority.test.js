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
