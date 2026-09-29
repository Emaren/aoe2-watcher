"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  beginRendererBoot,
  beginRendererRecovery,
  buildRendererHealthMetadata,
  closeRenderer,
  completeRendererBoot,
  createRendererHealthState,
  failRenderer,
  sanitizeDiagnosticMessage,
} = require("../rendererHealth");

test("renderer health distinguishes closed, booting, ready, failed, and recovered states", () => {
  let state = createRendererHealthState();
  assert.equal(state.status, "closed");
  assert.equal(state.ready, false);

  state = beginRendererBoot(state, {
    now: 1_000,
    resetReloadAttempts: true,
  });
  assert.equal(state.status, "booting");
  assert.equal(state.dashboardOpen, true);
  assert.equal(state.reloadAttempts, 0);

  state = failRenderer(state, {
    now: 2_000,
    reason: "boot timeout",
    error: "renderer did not answer",
  });
  assert.equal(state.status, "failed");
  assert.equal(state.ready, false);
  assert.equal(state.failureReason, "boot_timeout");
  assert.equal(state.failureCount, 1);

  state = beginRendererRecovery(state, { now: 2_500 });
  assert.equal(state.status, "recovering");
  assert.equal(state.reloadAttempts, 1);

  state = beginRendererBoot(state, { now: 3_000 });
  state = completeRendererBoot(state, {
    now: 3_140,
  });
  assert.equal(state.status, "ready");
  assert.equal(state.ready, true);
  assert.equal(state.bootstrapMs, 140);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.failureCount, 1);

  state = closeRenderer(state);
  assert.equal(state.status, "closed");
  assert.equal(state.dashboardOpen, false);
  assert.equal(state.ready, false);
  assert.equal(state.failureCount, 1);
});

test("nonfatal renderer errors remain diagnostic without declaring the dashboard dead", () => {
  let state = completeRendererBoot(
    beginRendererBoot(createRendererHealthState(), { now: 1_000 }),
    { now: 1_100 }
  );

  state = failRenderer(state, {
    now: 1_500,
    reason: "unhandled rejection",
    error: "optional UI action failed",
    fatal: false,
  });

  assert.equal(state.status, "ready");
  assert.equal(state.ready, true);
  assert.equal(state.failureReason, "unhandled_rejection");
  assert.equal(state.failureCount, 1);
});

test("renderer diagnostics redact obvious keys and local paths", () => {
  const message =
    "apiKey=secret C:\\Users\\Tekki\\AppData\\Roaming\\AoE2\\file.js /Users/tony/private/file.js";

  const sanitized = sanitizeDiagnosticMessage(message);

  assert.doesNotMatch(sanitized, /secret/);
  assert.doesNotMatch(sanitized, /Tekki/);
  assert.doesNotMatch(sanitized, /tony/);
  assert.match(sanitized, /\[redacted\]/);
  assert.match(sanitized, /\[local-path\]/);
});

test("heartbeat metadata exposes support-grade renderer state without raw paths", () => {
  let state = beginRendererBoot(createRendererHealthState(), { now: 1_000 });
  state = failRenderer(state, {
    now: 2_000,
    reason: "preload_error",
    error: "C:\\Users\\Tekki\\Watcher\\preload.js failed",
  });

  const metadata = buildRendererHealthMetadata(state);

  assert.equal(metadata.rendererStatus, "failed");
  assert.equal(metadata.rendererReady, false);
  assert.equal(metadata.rendererFailureReason, "preload_error");
  assert.equal(metadata.rendererReloadAttempts, 0);
  assert.doesNotMatch(metadata.rendererLastError, /Tekki/);
});

test("main and renderer source keep the remote bootstrap diagnosis contract wired", () => {
  const root = path.join(__dirname, "..");
  const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "preload.js"), "utf8");

  assert.match(mainSource, /watcher:renderer-ready/);
  assert.match(mainSource, /watcher:renderer-error/);
  assert.match(mainSource, /reloadIgnoringCache/);
  assert.match(mainSource, /preload-error/);
  assert.match(mainSource, /render-process-gone/);
  assert.match(rendererSource, /reportRendererError/);
  assert.match(rendererSource, /rendererReady/);
  assert.match(preloadSource, /watcher:renderer-ready/);
  assert.match(preloadSource, /watcher:renderer-error/);
});
