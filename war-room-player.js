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

  // Require explicit timezone and an actual calendar date. Date.parse alone
  // silently normalizes impossible dates on some JS engines.
  const asDate = (value) => {
    if (typeof value !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) return null;
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) return null;
    if (m[8] !== "Z") {
      const offsetHour = Number(m[8].slice(1, 3));
      const offsetMinute = Number(m[8].slice(4, 6));
      if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    }
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  };

  function normalizeRating(raw, maximumTime) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = number(raw.value, 6000);
    const when = asDate(raw.asOf);
    if (value === null || when === null || when > maximumTime + FUTURE_SKEW_MS ||
        !["steam", "official"].includes(raw.authority)) return null;
    return Object.freeze({ value, asOf: raw.asOf, authority: raw.authority });
  }

  function normalizeMatch(raw, maximumTime) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const playedAt = asDate(raw.playedAt);
    if (!RESULTS.has(raw.result) || !MODES.has(raw.mode) || playedAt === null ||
        playedAt > maximumTime + FUTURE_SKEW_MS) return null;
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

  const safeProfileLocale = value => {
    const text = typeof value === "string" ? value.trim().toLowerCase().replace(/_/g, "-") : "";
    return text === "fr" || text.startsWith("fr-") ? "fr"
      : text === "en" || text.startsWith("en-") ? "en" : null;
  };

  function safePublicAvatar(value) {
    if (typeof value !== "string" || value.length > 600) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" ||
          !["aoe2war.com", "www.aoe2war.com"].includes(url.hostname) ||
          url.username || url.password || !/^\\/(?:[^\\\\]|%[0-9a-fA-F]{2})*$/.test(url.pathname)) return null;
      return url.href;
    } catch { return null; }
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
      ? input.recentMatches.slice(0, MAX_MATCHES).map(match => normalizeMatch(match, asOf)).filter(Boolean) : [];

    return Object.freeze({
      status: "verified",
      generatedAt: input.generatedAt,
      displayName: name,
      preferredLanguage: safeProfileLocale(input.player?.language ?? input.player?.locale),
      avatarUrl: safePublicAvatar(input.player?.avatarUrl),
      record: validRecord ? Object.freeze({ wins, losses, unresolved, winRate }) : null,
      ratings: Object.freeze({ rm: normalizeRating(rating.rm, asOf), dm: normalizeRating(rating.dm, asOf) }),
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

  const api = Object.freeze({ normalize, duration, SCHEMA_VERSION, MAX_MATCHES, MAX_AGE_MS });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) root.WarRoomPlayer = api;
})(typeof window !== "undefined" ? window : null);
