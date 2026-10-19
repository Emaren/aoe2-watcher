"use strict";

/**
 * Presentation-only Watcher player-summary contract.
 * This module CANNOT establish account ownership. Call normalize() ONLY with
 * data from a separately reviewed, key-authenticated, owner-scoped desktop IPC.
 * It never fetches URLs, reads or stores credentials, or uses a profile selector.
 */
(function attachWarRoomPlayer(root) {
  const SCHEMA_VERSION = 1;
  const MAX_AGE_MS = 10 * 60 * 1000;
  const FUTURE_SKEW_MS = 60 * 1000;
  const MAX_MATCHES = 5;
  const RESULTS = new Set(["win", "loss", "unresolved"]);
  const MODES = new Set(["rm", "dm"]);
  const placeholder = Object.freeze({ status: "unavailable", reason: "Awaiting authenticated player data" });

  const number = (value, max = 1000000000) =>
    Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;

  const label = (value, maxLength = 90) => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";

  const asDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  };

  function normalizeRating(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = number(raw.value, 6000);
    const when = asDate(raw.asOf);
    if (value === null || when === null || !["steam", "official"].includes(raw.authority)) return null;
    return Object.freeze({ value, asOf: raw.asOf, authority: raw.authority });
  }

  function normalizeMatch(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!RESULTS.has(raw.result) || !MODES.has(raw.mode) || asDate(raw.playedAt) === null) return null;
    const opponent = label(raw.opponent, 65);
    const map = label(raw.map, 65);
    if (!opponent) return null;
    return Object.freeze({
      opponent,
      map: map || "Map unavailable",
      mode: raw.mode,
      result: raw.result,
      playedAt: raw.playedAt,
    });
  }

  function normalizeStreaming(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const sessions = raw.sessions === null ? null : number(raw.sessions);
    const airtimeSeconds = raw.airtimeSeconds === null ? null : number(raw.airtimeSeconds);
    const peakConcurrentViewers = raw.peakConcurrentViewers === null
      ? null : number(raw.peakConcurrentViewers);
    return Object.freeze({ sessions, airtimeSeconds, peakConcurrentViewers });
  }

  function normalize(input, now = Date.now()) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return placeholder;
    // Offline, stale, re-pairing or permission errors must NEVER reuse
    // a previously verified player's record from another key.
    if (input.status !== "verified" || input.schemaVersion !== SCHEMA_VERSION) return placeholder;
    const asOf = asDate(input.generatedAt);
    if (asOf === null || asOf > now + FUTURE_SKEW_MS || now - asOf > MAX_AGE_MS) {
      return Object.freeze({ status: "stale", reason: "Player statistics are out of date" });
    }

    const name = label(input.player?.displayName, 65);
    if (!name) return placeholder;
    const record = input.record && typeof input.record === "object" && !Array.isArray(input.record)
      ? input.record : null;
    const wins = record ? number(record.wins) : null;
    const losses = record ? number(record.losses) : null;
    const unresolved = record && record.unresolved !== null ? number(record.unresolved) : null;
    // Partial W/L totals cannot yield a meaningful fraction or win-rate.
    const validRecord = wins !== null && losses !== null;
    const decided = validRecord ? wins + losses : 0;
    const winRate = decided > 0 ? Math.round((wins / decided) * 100) : null;

    const rating = input.ratings && typeof input.ratings === "object" && !Array.isArray(input.ratings)
      ? input.ratings : {};
    const list = Array.isArray(input.recentMatches)
      ? input.recentMatches.slice(0, MAX_MATCHES).map(normalizeMatch).filter(Boolean) : [];

    return Object.freeze({
      status: "verified",
      generatedAt: input.generatedAt,
      displayName: name,
      record: validRecord ? Object.freeze({ wins, losses, unresolved, winRate }) : null,
      ratings: Object.freeze({ rm: normalizeRating(rating.rm), dm: normalizeRating(rating.dm) }),
      recentMatches: Object.freeze(list),
      streaming: normalizeStreaming(input.streaming),
    });
  }

  function duration(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds < 0) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours + "h " + String(minutes).padStart(2, "0") + "m";
  }

  const api = Object.freeze({ normalize, duration, SCHEMA_VERSION, MAX_MATCHES });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) root.WarRoomPlayer = api;
})(typeof window !== "undefined" ? window : null);
