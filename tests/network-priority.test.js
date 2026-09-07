const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createNetworkPriorityArbiter,
} = require("../networkPriority");

function fakeController() {
  return {
    aborted: false,
    reason: null,
    abort(reason) {
      this.aborted = true;
      this.reason = reason;
    },
  };
}

test("replay upload preempts an in-flight video upload", () => {
  const arbiter =
    createNetworkPriorityArbiter();
  const video =
    fakeController();

  assert.equal(
    arbiter.registerStreamUpload(video),
    true,
  );

  const result =
    arbiter.handleReplayEvent({
      type: "upload-start",
      filePath: "/replays/live.aoe2record",
      isFinal: false,
    });

  assert.equal(
    result.replayPriorityActive,
    true,
  );
  assert.equal(
    result.preemptedVideoUploads,
    1,
  );
  assert.equal(video.aborted, true);
  assert.equal(
    video.reason,
    "replay_upload_priority",
  );
});

test("video cannot start while replay bytes own network priority", () => {
  const arbiter =
    createNetworkPriorityArbiter();

  arbiter.handleReplayEvent({
    type: "upload-start",
    fileName: "live.aoe2record",
    isFinal: true,
  });

  const video =
    fakeController();

  assert.equal(
    arbiter.registerStreamUpload(video),
    false,
  );
  assert.equal(video.aborted, true);
});

test("retry backoff releases video until the next replay attempt", () => {
  const arbiter =
    createNetworkPriorityArbiter();
  const replay = {
    filePath: "/replays/live.aoe2record",
    isFinal: false,
  };

  arbiter.handleReplayEvent({
    ...replay,
    type: "upload-start",
  });

  assert.equal(
    arbiter.isReplayPriorityActive(),
    true,
  );

  arbiter.handleReplayEvent({
    ...replay,
    type: "upload-retry",
  });

  assert.equal(
    arbiter.isReplayPriorityActive(),
    false,
  );

  const video =
    fakeController();

  assert.equal(
    arbiter.registerStreamUpload(video),
    true,
  );

  arbiter.handleReplayEvent({
    ...replay,
    type: "upload-start",
  });

  assert.equal(video.aborted, true);
});

test("concurrent replay transfers keep priority until all active transfers finish", () => {
  const arbiter =
    createNetworkPriorityArbiter();

  arbiter.handleReplayEvent({
    type: "upload-start",
    filePath: "/replays/a.aoe2record",
    isFinal: false,
  });

  arbiter.handleReplayEvent({
    type: "upload-start",
    filePath: "/replays/b.aoe2record",
    isFinal: true,
  });

  arbiter.handleReplayEvent({
    type: "upload-success",
    filePath: "/replays/a.aoe2record",
    isFinal: false,
  });

  assert.equal(
    arbiter.isReplayPriorityActive(),
    true,
  );

  arbiter.handleReplayEvent({
    type: "upload-failure",
    filePath: "/replays/b.aoe2record",
    isFinal: true,
  });

  assert.equal(
    arbiter.isReplayPriorityActive(),
    false,
  );
});
