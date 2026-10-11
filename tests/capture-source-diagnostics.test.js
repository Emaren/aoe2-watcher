"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  readScreenCapturePermission,
  describeCaptureSourceFailure,
} = require("../captureSourceDiagnostics");

test("macOS reads screen permission without requesting access", () => {
  let calls = 0;
  const preferences = { getMediaAccessStatus(kind) { assert.equal(kind, "screen"); calls += 1; return "denied"; } };
  assert.equal(readScreenCapturePermission({ platform: "darwin", preferences }), "denied");
  assert.equal(calls, 1);
  assert.equal(readScreenCapturePermission({ platform: "linux", preferences }), "not-applicable");
  assert.equal(calls, 1);
});

test("permission probes fail safely when unavailable", () => {
  assert.equal(readScreenCapturePermission({ platform: "darwin", preferences: null }), "unknown");
  assert.equal(readScreenCapturePermission({ platform: "darwin", preferences: {
    getMediaAccessStatus() { throw new Error("unavailable"); },
  } }), "unknown");
  assert.equal(readScreenCapturePermission({ platform: "darwin", preferences: {
    getMediaAccessStatus() { return "unexpected"; },
  } }), "unknown");
});

test("denied and unresolved source scans give actionable macOS instructions and preserve the cause", () => {
  const denied = describeCaptureSourceFailure(new Error("Failed to get sources."), "denied", "darwin");
  assert.match(denied, /System Settings > Privacy & Security/);
  assert.match(denied, /fully quit and reopen Watcher/);
  assert.match(denied, /Failed to get sources/);
  const pending = describeCaptureSourceFailure("No capture sources returned", "not-determined", "darwin");
  assert.match(pending, /not yet confirmed/);
  assert.match(pending, /No capture sources returned/);
});

test("granted permissions do not become false permission-denied diagnoses", () => {
  const message = describeCaptureSourceFailure(new Error("Capture backend unavailable"), "granted", "darwin");
  assert.match(message, /screen permission: granted/);
  assert.match(message, /Capture backend unavailable/);
  assert.doesNotMatch(message, /screen recording is denied/);
});

test("non-Mac capture errors are not assigned Mac permission advice", () => {
  const message = describeCaptureSourceFailure("backend unavailable", "not-applicable", "linux");
  assert.equal(message, "Video source discovery failed: backend unavailable");
});
