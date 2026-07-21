const assert = require("node:assert/strict");
const axios = require("axios");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildPersistedSettlementState,
  buildReplayReceiptDetail,
  classifyReplayAcceptance,
  getFileFingerprint,
  getReplayContentHash,
  importHistoricalReplays,
  resolveFinalReplayShortCircuit,
  restorePersistedSettlementState,
  shouldRecheckKnownFinalFingerprint,
  summarizeUploadResponse,
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
    lastFinalCandidateAt: 0,
    lastFinalCandidateFingerprint: null,
    lastFinalDeferralReason: null,
    lastFinalDeferralNoticeAt: 0,
    lastReplayGrowthNoticeAt: 0,
    monitorStartedAt: 0,
    finalAccepted: false,
    finalStored: false,
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
    finalAccepted: true,
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
    finalAccepted: true,
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
    finalAccepted: true,
  });

  const result = await resolveFinalReplayShortCircuit(filePath, entry, {
    finalSettleWindowMs: 90000,
  });

  assert.equal(result, null);
});

test("does not short-circuit an unaccepted final candidate", async (t) => {
  const filePath = await createTempReplay(t, Buffer.from("candidate replay"));
  const fingerprint = await getFileFingerprint(filePath);
  const replayHash = await getReplayContentHash(filePath);
  const entry = buildEntry({
    lastObservedFingerprint: fingerprint,
    lastFinalUploadedFingerprint: fingerprint,
    lastFinalReplayHash: replayHash,
    lastFinalUploadAt: Date.now() - 120000,
    finalAccepted: false,
  });

  const result = await resolveFinalReplayShortCircuit(filePath, entry, {
    finalSettleWindowMs: 90000,
  });

  assert.equal(result, null);
});

test("short-circuits an archived final routed to private result review", async (t) => {
  const filePath = await createTempReplay(t, Buffer.from("archived review replay"));
  const fingerprint = await getFileFingerprint(filePath);
  const entry = buildEntry({
    lastObservedFingerprint: fingerprint,
    lastFinalUploadedFingerprint: fingerprint,
    lastFinalUploadAt: Date.now() - 120000,
    finalAccepted: false,
    finalStored: true,
  });

  const result = await resolveFinalReplayShortCircuit(filePath, entry, {
    finalSettleWindowMs: 90000,
  });

  assert.deepEqual(result, {
    reason: "settled_fingerprint",
    fingerprint,
  });
});

test("routes a parsed final_not_ready response to review without accepting the result", () => {
  const summary = summarizeUploadResponse({
    message: "Final proof stored; result under review",
    replay_hash: "abc123",
    finality_status: "final_not_ready",
    final_accepted: false,
    should_settle: false,
    pending_parse: false,
    raw_replay_archived: true,
  });
  const acceptance = classifyReplayAcceptance(summary, { isFinal: true });

  assert.deepEqual(acceptance, {
    archived: true,
    parsed: true,
    resultReady: false,
    reviewRouted: true,
  });
  assert.match(
    buildReplayReceiptDetail("team-game.aoe2record", acceptance),
    /parsed and routed through result review/i
  );
});

test("accepts only an explicit trusted final as result ready", () => {
  const summary = summarizeUploadResponse({
    replay_hash: "def456",
    finality_status: "trusted_final",
    final_accepted: true,
    should_settle: true,
    raw_replay_archived: true,
  });

  assert.deepEqual(classifyReplayAcceptance(summary, { isFinal: true }), {
    archived: true,
    parsed: true,
    resultReady: true,
    reviewRouted: false,
  });
});

test("keeps archived unparsed proof out of parsed and result-ready totals", () => {
  const summary = summarizeUploadResponse({
    replay_hash: "ghi789",
    finality_status: "final_unparsed_proof",
    final_accepted: false,
    should_settle: false,
    unparsed_final: true,
    raw_replay_archived: true,
  });

  assert.deepEqual(classifyReplayAcceptance(summary, { isFinal: true }), {
    archived: true,
    parsed: false,
    resultReady: false,
    reviewRouted: true,
  });
});

test("does not route live replay receipts through final result review", () => {
  const summary = summarizeUploadResponse({
    finality_status: "live",
    final_accepted: false,
  });

  assert.deepEqual(classifyReplayAcceptance(summary, { isFinal: false }), {
    archived: false,
    parsed: true,
    resultReady: false,
    reviewRouted: false,
  });
});

test("batch import never counts a 2xx final_not_ready receipt as result ready", async (t) => {
  const filePath = await createTempReplay(t, Buffer.from("stable team replay bytes"));
  const previousPost = axios.post;
  axios.post = async () => ({
    status: 200,
    data: {
      message: "Final proof stored; result under review",
      replay_hash: "batch-review-hash",
      finality_status: "final_not_ready",
      final_accepted: false,
      should_settle: false,
      pending_parse: false,
      raw_replay_archived: true,
    },
  });
  t.after(() => {
    axios.post = previousPost;
  });

  const state = await importHistoricalReplays(
    {
      watchDir: path.dirname(filePath),
      uploadApiKey: "test-watcher-key",
      apiBaseUrl: "https://watcher-test.invalid",
      apiFallbackBaseUrl: "",
    },
    { source: "test", filePaths: [filePath] }
  );

  assert.equal(state.uploaded, 1);
  assert.equal(state.archived, 1);
  assert.equal(state.parsed, 1);
  assert.equal(state.resultReady, 0);
  assert.equal(state.reviewRouted, 1);
  assert.equal(state.failed, 0);
  assert.equal(state.recentItems[0]?.status, "review_routed");
  assert.match(state.summaryText, /result ready 0/i);
  assert.match(state.summaryText, /review routed 1/i);
});


test("rechecks an archived unresolved final when its fingerprint changes after monitor exit", () => {
  const entry = buildEntry({
    monitoring: false,
    finalAccepted: false,
    finalStored: true,
    lastFinalUploadedFingerprint: "1000:100",
  });

  assert.equal(
    shouldRecheckKnownFinalFingerprint(
      entry,
      "1100:200"
    ),
    true
  );
});


test("does not recheck a known final when its fingerprint is unchanged", () => {
  const entry = buildEntry({
    monitoring: false,
    finalAccepted: false,
    finalStored: true,
    lastFinalUploadedFingerprint: "1000:100",
  });

  assert.equal(
    shouldRecheckKnownFinalFingerprint(
      entry,
      "1000:100"
    ),
    false
  );
});


test("does not run recovery divergence logic while the replay monitor is already active", () => {
  const entry = buildEntry({
    monitoring: true,
    finalAccepted: false,
    finalStored: true,
    lastFinalUploadedFingerprint: "1000:100",
  });

  assert.equal(
    shouldRecheckKnownFinalFingerprint(
      entry,
      "1100:200"
    ),
    false
  );
});


test("does not treat a never-finalized replay as a known-final divergence", () => {
  const entry = buildEntry({
    monitoring: false,
    finalAccepted: false,
    finalStored: false,
    lastFinalUploadedFingerprint: "1000:100",
  });

  assert.equal(
    shouldRecheckKnownFinalFingerprint(
      entry,
      "1100:200"
    ),
    false
  );
});


test("persists final replay fingerprint and hash across watcher restart", () => {
  const now = Date.now();
  const filePath = "/tmp/example-final.aoe2record";

  const state = new Map([
    [
      filePath,
      buildEntry({
        monitoring: false,
        finalAccepted: false,
        finalStored: true,
        lastObservedFingerprint: "1000:100",
        lastFinalUploadedFingerprint: "1000:100",
        lastFinalReplayHash: "a".repeat(64),
        lastFinalUploadAt: now,
      }),
    ],
  ]);

  const snapshot =
    buildPersistedSettlementState(
      state,
      now
    );

  const restored =
    restorePersistedSettlementState(
      snapshot,
      {
        watchDir: "/tmp",
        now,
      }
    );

  const entry =
    restored.get(filePath);

  assert.ok(entry);
  assert.equal(
    entry.finalStored,
    true
  );
  assert.equal(
    entry.finalAccepted,
    false
  );
  assert.equal(
    entry.lastFinalUploadedFingerprint,
    "1000:100"
  );
  assert.equal(
    entry.lastFinalReplayHash,
    "a".repeat(64)
  );
});


test("restored final state rechecks changed fingerprint after watcher restart", () => {
  const now = Date.now();
  const filePath = "/tmp/example-final.aoe2record";

  const restored =
    restorePersistedSettlementState(
      {
        version: 1,
        entries: [
          {
            filePath,
            lastObservedFingerprint:
              "1000:100",
            lastFinalUploadedFingerprint:
              "1000:100",
            lastFinalReplayHash:
              "b".repeat(64),
            lastFinalUploadAt:
              now,
            finalAccepted:
              false,
            finalStored:
              true,
          },
        ],
      },
      {
        watchDir: "/tmp",
        now,
      }
    );

  const entry =
    restored.get(filePath);

  assert.ok(entry);

  assert.equal(
    shouldRecheckKnownFinalFingerprint(
      entry,
      "1100:200"
    ),
    true
  );
});


test("does not restore stale persisted final state", () => {
  const now = Date.now();
  const filePath = "/tmp/stale-final.aoe2record";

  const restored =
    restorePersistedSettlementState(
      {
        version: 1,
        entries: [
          {
            filePath,
            lastFinalUploadedFingerprint:
              "1000:100",
            lastFinalReplayHash:
              "c".repeat(64),
            lastFinalUploadAt:
              now -
              120 * 24 * 60 * 60 * 1000,
            finalAccepted:
              false,
            finalStored:
              true,
          },
        ],
      },
      {
        watchDir: "/tmp",
        now,
      }
    );

  assert.equal(
    restored.size,
    0
  );
});


test("does not restore persisted final state outside active watch directory", () => {
  const now = Date.now();

  const restored =
    restorePersistedSettlementState(
      {
        version: 1,
        entries: [
          {
            filePath:
              "/somewhere-else/game.aoe2record",
            lastFinalUploadedFingerprint:
              "1000:100",
            lastFinalReplayHash:
              "d".repeat(64),
            lastFinalUploadAt:
              now,
            finalAccepted:
              true,
            finalStored:
              true,
          },
        ],
      },
      {
        watchDir:
          "/tmp/aoe2-savegame",
        now,
      }
    );

  assert.equal(
    restored.size,
    0
  );
});
