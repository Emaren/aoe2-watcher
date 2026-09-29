"use strict";

const DEFAULT_RENDERER_BOOT_TIMEOUT_MS = 12 * 1000;

function isoTimestamp(value) {
  const number = Number(value);
  return new Date(Number.isFinite(number) ? number : Date.now()).toISOString();
}

function safeReason(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function sanitizeDiagnosticMessage(value, maxLength = 300) {
  let text = String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text
    .replace(/(?:apiKey|watcherKey|x-api-key)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[local-path]")
    .replace(/\/(?:Users|home)\/[^/\s]+\/[^\s]*/g, "[local-path]");

  return text.slice(0, Math.max(40, Number(maxLength) || 300));
}

function createRendererHealthState() {
  return {
    status: "closed",
    dashboardOpen: false,
    ready: false,
    bootStartedAt: null,
    readyAt: null,
    bootstrapMs: null,
    lastFailureAt: null,
    failureReason: null,
    lastError: null,
    failureCount: 0,
    consecutiveFailures: 0,
    reloadAttempts: 0,
  };
}

function beginRendererBoot(
  state = createRendererHealthState(),
  { now = Date.now(), resetReloadAttempts = false } = {}
) {
  return {
    ...state,
    status: "booting",
    dashboardOpen: true,
    ready: false,
    bootStartedAt: isoTimestamp(now),
    readyAt: null,
    bootstrapMs: null,
    reloadAttempts: resetReloadAttempts ? 0 : Number(state.reloadAttempts || 0),
  };
}

function completeRendererBoot(
  state = createRendererHealthState(),
  { now = Date.now(), bootstrapMs = null } = {}
) {
  const measured =
    Number.isFinite(Number(bootstrapMs)) && Number(bootstrapMs) >= 0
      ? Number(bootstrapMs)
      : state.bootStartedAt
        ? Math.max(0, Number(now) - Date.parse(state.bootStartedAt))
        : null;

  return {
    ...state,
    status: "ready",
    dashboardOpen: true,
    ready: true,
    readyAt: isoTimestamp(now),
    bootstrapMs: measured === null ? null : Math.round(measured),
    consecutiveFailures: 0,
  };
}

function failRenderer(
  state = createRendererHealthState(),
  {
    now = Date.now(),
    reason = "unknown",
    error = "",
    fatal = true,
  } = {}
) {
  const next = {
    ...state,
    lastFailureAt: isoTimestamp(now),
    failureReason: safeReason(reason),
    lastError: sanitizeDiagnosticMessage(error),
    failureCount: Number(state.failureCount || 0) + 1,
    consecutiveFailures: Number(state.consecutiveFailures || 0) + 1,
  };

  if (fatal) {
    next.status = "failed";
    next.ready = false;
  }

  return next;
}

function beginRendererRecovery(
  state = createRendererHealthState(),
  { now = Date.now() } = {}
) {
  return {
    ...state,
    status: "recovering",
    dashboardOpen: true,
    ready: false,
    bootStartedAt: isoTimestamp(now),
    readyAt: null,
    bootstrapMs: null,
    reloadAttempts: Number(state.reloadAttempts || 0) + 1,
  };
}

function closeRenderer(state = createRendererHealthState()) {
  return {
    ...state,
    status: "closed",
    dashboardOpen: false,
    ready: false,
    bootStartedAt: null,
    readyAt: null,
    bootstrapMs: null,
  };
}

function buildRendererHealthMetadata(state = createRendererHealthState()) {
  return {
    dashboardOpen: Boolean(state.dashboardOpen),
    rendererStatus: state.status || "closed",
    rendererReady: Boolean(state.ready),
    rendererBootStartedAt: state.bootStartedAt || null,
    rendererReadyAt: state.readyAt || null,
    rendererBootstrapMs:
      Number.isFinite(Number(state.bootstrapMs)) ? Number(state.bootstrapMs) : null,
    rendererLastFailureAt: state.lastFailureAt || null,
    rendererFailureReason: state.failureReason || null,
    rendererLastError: state.lastError || null,
    rendererFailureCount: Number(state.failureCount || 0),
    rendererConsecutiveFailures: Number(state.consecutiveFailures || 0),
    rendererReloadAttempts: Number(state.reloadAttempts || 0),
  };
}

module.exports = {
  DEFAULT_RENDERER_BOOT_TIMEOUT_MS,
  beginRendererBoot,
  beginRendererRecovery,
  buildRendererHealthMetadata,
  closeRenderer,
  completeRendererBoot,
  createRendererHealthState,
  failRenderer,
  sanitizeDiagnosticMessage,
};
