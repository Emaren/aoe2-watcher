const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  getFileFingerprint,
  getReplayContentHash,
  resolveFinalReplayShortCircuit,
} = require("./watcher");

function buildEntry(overrides = {}) {
  return {
    monitoring: false,
    importing: false,
    lastObservedFingerprint: null,
    lastChangeAt: 0,
    lastLiveAttemptAt: 0,
    lastLiveUploadAt: 0,
    lastLiveUploadedFingerprint: null,
    lastFinalUploadedFingerprint: null,
    lastFinalReplayHash: null,
    lastFinalUploadAt: 0,
    lastReplayGrowthNoticeAt: 0,
    liveIteration: 0,
    ...overrides,
  };
}

async function createTempReplay(t, content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aoe2-watcher-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "test-replay.aoe2record");
  await fs.writeFile(filePath, content);
  return filePath;
}

test("short-circuits when the replay fingerprint is already settled", async (t) => {
  const filePath = await createTempReplay(t, Buffer.from("settled replay"));
  const fingerprint = await getFileFingerprint(filePath);
  const entry = buildEntry({
    lastObservedFingerprint: fingerprint,
    lastFinalUploadedFingerprint: fingerprint,
    lastFinalUploadAt: Date.now() - 120000,
  });

  const result = await resolveFinalReplayShortCircuit(filePath, entry, {
    finalSettleWindowMs: 90000,
  });

  assert.deepEqual(result, {
    reason: "settled_fingerprint",
    fingerprint,
  });
});

test("short-circuits when a touched replay still matches the prior final replay hash", async (t) => {
  const filePath = await createTempReplay(t, Buffer.from("same final replay bytes"));
  const originalFingerprint = await getFileFingerprint(filePath);
  const replayHash = await getReplayContentHash(filePath);

  const touchedAt = new Date(Date.now() + 3000);
  await fs.utimes(filePath, touchedAt, touchedAt);
  const touchedFingerprint = await getFileFingerprint(filePath);

  assert.notEqual(touchedFingerprint, originalFingerprint);

  const entry = buildEntry({
    lastObservedFingerprint: originalFingerprint,
    lastFinalUploadedFingerprint: originalFingerprint,
    lastFinalReplayHash: replayHash,
    lastFinalUploadAt: Date.now(),
  });

  const result = await resolveFinalReplayShortCircuit(filePath, entry, {
    finalSettleWindowMs: 90000,
  });

  assert.equal(result?.reason, "settled_replay_hash");
  assert.equal(result?.replayHash, replayHash);
  assert.equal(entry.lastObservedFingerprint, touchedFingerprint);
  assert.equal(entry.lastFinalUploadedFingerprint, touchedFingerprint);
});

test("does not short-circuit when the replay bytes changed after final upload", async (t) => {
  const filePath = await createTempReplay(t, Buffer.from("original final replay"));
  const originalFingerprint = await getFileFingerprint(filePath);
  const replayHash = await getReplayContentHash(filePath);

  await fs.writeFile(filePath, Buffer.from("mutated replay after final"));
  const entry = buildEntry({
    lastObservedFingerprint: originalFingerprint,
    lastFinalUploadedFingerprint: originalFingerprint,
    lastFinalReplayHash: replayHash,
    lastFinalUploadAt: Date.now(),
  });

  const result = await resolveFinalReplayShortCircuit(filePath, entry, {
    finalSettleWindowMs: 90000,
  });

  assert.equal(result, null);
});
