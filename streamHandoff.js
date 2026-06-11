const path = require("path");

const DEFAULT_STREAM_BASE_URL = "https://aoe2war.com";
const REPLAY_EXTENSIONS = new Set([
  ".aoe2record",
  ".aoe2mpgame",
  ".mgz",
  ".mgx",
  ".mgl",
]);

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeWebBaseUrl(value = DEFAULT_STREAM_BASE_URL) {
  const raw = compactText(value) || DEFAULT_STREAM_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_STREAM_BASE_URL;
  }
}

function stripReplayExtension(value) {
  const basename = path.basename(compactText(value));
  const extension = path.extname(basename).toLowerCase();

  if (REPLAY_EXTENSIONS.has(extension)) {
    return basename.slice(0, -extension.length);
  }

  return basename;
}

function buildStreamSessionKey(candidate = {}) {
  return compactText(
    candidate.streamSession ||
      candidate.sessionKey ||
      candidate.originalFilename ||
      candidate.fileName ||
      (candidate.filePath ? path.basename(candidate.filePath) : "")
  ).slice(0, 240);
}

function buildStreamTitle(candidate = {}) {
  const explicitTitle = compactText(
    candidate.streamTitle ||
      candidate.matchTitle ||
      candidate.title ||
      candidate.gameTitle ||
      candidate.displayName
  );

  if (explicitTitle) {
    return explicitTitle.slice(0, 140);
  }

  return (
    stripReplayExtension(
      candidate.fileName ||
        candidate.originalFilename ||
        candidate.sessionKey ||
        candidate.filePath ||
        "AoE2WAR live"
    ) || "AoE2WAR live"
  ).slice(0, 140);
}

function buildStreamHandoff(candidate = {}, options = {}) {
  const sessionKey = buildStreamSessionKey(candidate);
  const title = buildStreamTitle(candidate);
  const webBaseUrl = normalizeWebBaseUrl(
    options.webBaseUrl || candidate.webBaseUrl || DEFAULT_STREAM_BASE_URL
  );
  const url = new URL("/profile", webBaseUrl);

  url.searchParams.set("watcher_stream", "1");
  if (sessionKey) {
    url.searchParams.set("stream_session", sessionKey);
  }
  if (title) {
    url.searchParams.set("stream_title", title);
  }

  return {
    ok: Boolean(sessionKey),
    url: url.toString(),
    webBaseUrl,
    sessionKey,
    title,
  };
}

module.exports = {
  DEFAULT_STREAM_BASE_URL,
  buildStreamHandoff,
  buildStreamSessionKey,
  buildStreamTitle,
  normalizeWebBaseUrl,
  stripReplayExtension,
};
