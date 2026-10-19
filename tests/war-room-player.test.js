"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../war-room-player");

const now = Date.parse("2026-10-19T17:00:00.000Z");
const summary = (overrides = {}) => ({
  schemaVersion: 1,
  status: "verified",
  generatedAt: "2026-10-19T16:58:00.000Z",
  player: { displayName: "Commander" },
  record: { wins: 8, losses: 2, unresolved: 3 },
  ratings: {
    rm: { value: 1220, authority: "steam", asOf: "2026-10-18T20:00:00Z" },
    dm: { value: 1380, authority: "steam", asOf: "2026-10-18T21:00:00Z" }
  },
  recentMatches: [{ opponent: "Jim", map: "Forest Prison", mode: "dm", result: "win", playedAt: "2026-10-18T20:00:00Z" }],
  streaming: { sessions: 3, airtimeSeconds: 7400, peakConcurrentViewers: null },
  ...overrides
});

test("unavailable, unsupported, and forged statuses never become verified", () => {
  for (const input of [null, {}, [], summary({ schemaVersion: 2 }), summary({ status: "ready" }),
    summary({ status: "offline" }), summary({ status: "unauthorized" })]) {
    assert.notEqual(contract.normalize(input, now).status, "verified");
  }
});

test("stale or future-dated response never displays a previous player", () => {
  assert.equal(contract.normalize(summary({ generatedAt: "2026-10-19T16:40:00Z" }), now).status, "stale");
  assert.equal(contract.normalize(summary({ generatedAt: "2026-10-19T17:02:00Z" }), now).status, "stale");
  assert.equal(contract.normalize(summary({ generatedAt: "garbage" }), now).status, "stale");
});

test("a verified record yields only decided-game win rate and separate RM/DM authority", () => {
  const result = contract.normalize(summary(), now);
  assert.equal(result.status, "verified");
  assert.deepEqual(result.record, { wins: 8, losses: 2, unresolved: 3, winRate: 80 });
  assert.equal(result.ratings.rm.value, 1220);
  assert.equal(result.ratings.dm.value, 1380);
  assert.equal(result.streaming.peakConcurrentViewers, null);
  assert.equal(contract.duration(result.streaming.airtimeSeconds), "2h 03m");
});

test("real 0/0 is different from absent or partial records", () => {
  const empty = contract.normalize(summary({ record: { wins: 0, losses: 0, unresolved: 0 } }), now);
  assert.equal(empty.record.winRate, null);
  assert.deepEqual(empty.record, { wins: 0, losses: 0, unresolved: 0, winRate: null });
  assert.equal(contract.normalize(summary({ record: { wins: 1 } }), now).record, null);
  assert.equal(contract.normalize(summary({ record: { wins: "100", losses: 0 } }), now).record, null);
  assert.equal(contract.normalize(summary({ record: { wins: -2, losses: 0 } }), now).record, null);
});

test("an absent or malformed rating does not invent an ELO value", () => {
  const out = contract.normalize(summary({
    ratings: { rm: { value: 1320, asOf: "2026-10-18T20:00:00Z", authority: "guessed" },
      dm: { value: NaN, asOf: "2026-10-18T20:00:00Z", authority: "steam" } }
  }), now);
  assert.equal(out.ratings.rm, null);
  assert.equal(out.ratings.dm, null);
});

test("recent battles are capped at five and invalid outcomes cannot become victories", () => {
  const matches = Array.from({ length: 20 }, (_, i) => ({
    opponent: "Enemy" + i, map: "Arabia", mode: "rm",
    result: i === 1 ? "invented" : i === 2 ? "unresolved" : "win",
    playedAt: "2026-10-18T20:00:00Z"
  }));
  const normalized = contract.normalize(summary({ recentMatches: matches }), now);
  assert.equal(normalized.recentMatches.length, 4);
  assert.equal(normalized.recentMatches[1].result, "unresolved");
  assert.deepEqual(normalized.recentMatches.map(x => x.opponent), ["Enemy0", "Enemy2", "Enemy3", "Enemy4"]);
});

test("opponent, map, and player names are bounded and stripped of control characters", () => {
  const out = contract.normalize(summary({
    player: { displayName: "Name\n"+ "x".repeat(100) },
    recentMatches: [{ opponent: "Jim\r\nbad", map: "Forest\tPrison",
      mode: "dm", result: "loss", playedAt: "2026-10-18T20:00:00Z" }]
  }), now);
  assert.ok(!out.displayName.includes("\n"));
  assert.ok(out.displayName.length <= 65);
  assert.ok(!out.recentMatches[0].opponent.includes("\r"));
});

test("streaming absent numbers stay null, and duration never fabricates airtime", () => {
  const out = contract.normalize(summary({
    streaming: { sessions: 0, airtimeSeconds: null, peakConcurrentViewers: undefined }
  }), now);
  assert.deepEqual(out.streaming, { sessions: 0, airtimeSeconds: null, peakConcurrentViewers: null });
  assert.equal(contract.duration(null), "—");
  assert.equal(contract.duration(-3), "—");
});

test("module performs no file, fetch, timer, credential or signing activity", () => {
  const fs = require("node:fs");
  const text = fs.readFileSync(require("node:path").join(__dirname, "..", "war-room-player.js"), "utf8");
  assert.doesNotMatch(text, /\bfetch\s*\(|\bsetInterval\s*\(|\bXMLHttpRequest\b/);
  assert.doesNotMatch(text, /uploadApiKey|secret|wallet|signAndBroadcast|localStorage/);
});
