const test = require("node:test");
const assert = require("node:assert/strict");

const { detectUnknownParseFields } = require("../watcher");

test("live partial replay ignores winner proof gaps and populated player arrays", () => {
  const unknowns = detectUnknownParseFields(
    {
      winner: "Unknown",
      map: { name: "FN 5x5" },
      team_resolution: {
        teams: [
          { players: [{ name: "Jim" }, { name: "Scavanger_Ab" }] },
          { players: [{ name: "AT" }, { name: "ecartan" }] },
        ],
        result_evidence: {
          winner_flag_team_id: null,
          single_team_winner_flag_team_id: null,
        },
      },
      result_evidence: {
        winner_flag_team_id: null,
        single_team_winner_flag_team_id: null,
      },
    },
    { isFinal: false }
  );

  assert.deepEqual(unknowns, []);
});

test("final replay still reports unresolved winner evidence", () => {
  const unknowns = detectUnknownParseFields(
    {
      winner: "Unknown",
      team_resolution: {
        teams: [
          { players: [{ name: "Jim" }, { name: "Scavanger_Ab" }] },
          { players: [{ name: "AT" }, { name: "ecartan" }] },
        ],
        result_evidence: {
          winner_flag_team_id: null,
        },
      },
    },
    { isFinal: true }
  );

  assert.ok(unknowns.includes("winner"));
  assert.ok(
    unknowns.includes("team_resolution.result_evidence.winner_flag_team_id")
  );
  assert.equal(
    unknowns.some((field) => field.endsWith("players.name")),
    false
  );
});

test("live partial replay still reports structural map or player-name gaps", () => {
  const unknowns = detectUnknownParseFields(
    {
      map: "Unknown",
      players: [{ name: "Unknown" }, { name: "Jim" }],
      winner: "Unknown",
    },
    { isFinal: false }
  );

  assert.ok(unknowns.includes("map"));
  assert.ok(unknowns.includes("players.0.name"));
  assert.equal(unknowns.includes("winner"), false);
});

test("resolved final result ignores optional single-team winner evidence gaps", () => {
  const unknowns = detectUnknownParseFields(
    {
      winner: "copper_head_road",
      team_resolution: {
        result_status: "resolved",
        winning_team_id: 0,
        teams: [
          { players: [{ name: "Scavanger_Ab" }, { name: "Jim" }] },
          { players: [{ name: "AT" }, { name: "ecartan" }] },
        ],
        result_evidence: {
          winner_flag_team_id: 0,
          single_team_winner_flag_team_id: null,
        },
      },
      result_evidence: {
        winner_flag_team_id: 0,
        single_team_winner_flag_team_id: null,
      },
    },
    { isFinal: true }
  );

  assert.deepEqual(unknowns, []);
});

