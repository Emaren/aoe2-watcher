"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  classifyPowerSignal,
  createResourceProfiler,
  selectResourceSampleInterval,
  summarizeAppMetrics,
} = require("../resourceProfile");

test("summarizeAppMetrics combines the Electron process tree", () => {
  const summary = summarizeAppMetrics([
    {
      type: "Browser",
      cpu: {
        percentCPUUsage: 0.5,
        idleWakeupsPerSecond: 3,
      },
      memory: {
        workingSetSize: 102400,
        privateBytes: 81920,
        peakWorkingSetSize: 122880,
      },
    },
    {
      type: "Tab",
      cpu: {
        percentCPUUsage: 1.25,
        idleWakeupsPerSecond: 7,
      },
      memory: {
        workingSetSize: 51200,
        privateBytes: 40960,
        peakWorkingSetSize: 61440,
      },
    },
  ]);

  assert.equal(summary.processCount, 2);
  assert.equal(summary.cpuPercent, 1.75);
  assert.equal(summary.workingSetMb, 150);
  assert.equal(summary.privateMemoryMb, 120);
  assert.equal(summary.peakWorkingSetMb, 180);
  assert.equal(summary.idleWakeupsPerSecond, 10);
  assert.deepEqual(summary.processTypes, {
    Browser: 1,
    Tab: 1,
  });
});

test("resource sampling backs off when the Watcher is truly idle", () => {
  assert.equal(
    selectResourceSampleInterval({
      activeMs: 15_000,
      idleMs: 60_000,
    }),
    60_000
  );

  for (const workload of [
    { streamActive: true },
    { importRunning: true },
    { uploadActive: true },
    { activeReplay: true },
  ]) {
    assert.equal(
      selectResourceSampleInterval({
        ...workload,
        activeMs: 15_000,
        idleMs: 60_000,
      }),
      15_000
    );
  }
});

test("power signal never pretends to be watts", () => {
  assert.equal(
    classifyPowerSignal({
      cpuPercent: 0.4,
      idleWakeupsPerSecond: 3,
    }).key,
    "gentle"
  );

  assert.equal(
    classifyPowerSignal({
      cpuPercent: 0.4,
      idleWakeupsPerSecond: 3,
      streamActive: true,
    }).key,
    "streaming"
  );
});

test("resource profiler keeps rolling averages, peaks, and exact attempted network bytes", () => {
  let timestamp = 1_000_000;
  let metrics = [
    {
      type: "Browser",
      cpu: {
        percentCPUUsage: 1,
        idleWakeupsPerSecond: 5,
      },
      memory: {
        workingSetSize: 102400,
        privateBytes: 81920,
        peakWorkingSetSize: 112640,
      },
    },
  ];

  const profiler =
    createResourceProfiler({
      now: () => timestamp,
      getMetrics: () => metrics,
      getWorkload: () => ({
        uploadActive: true,
      }),
      windowSamples: 4,
    });

  let snapshot = profiler.sample();
  assert.equal(snapshot.workingSetMb, 100);
  assert.equal(snapshot.powerWatts, null);
  assert.equal(
    snapshot.powerMeasurement,
    "cpu-and-wakeup-proxy"
  );

  profiler.recordNetworkBytes(
    5_000_000,
    "replay"
  );
  timestamp += 10_000;
  metrics = [
    {
      type: "Browser",
      cpu: {
        percentCPUUsage: 3,
        idleWakeupsPerSecond: 15,
      },
      memory: {
        workingSetSize: 122880,
        privateBytes: 92160,
        peakWorkingSetSize: 133120,
      },
    },
  ];

  snapshot = profiler.sample();

  assert.equal(
    snapshot.sessionNetworkBytes,
    5_000_000
  );
  assert.equal(
    snapshot.replayUploadBytes,
    5_000_000
  );
  assert.equal(
    snapshot.streamUploadBytes,
    0
  );
  assert.equal(snapshot.networkMbps, 4);
  assert.equal(
    snapshot.sessionPeakWorkingSetMb,
    120
  );
  assert.equal(
    snapshot.sessionPeakCpuPercent,
    3
  );
  assert.equal(
    snapshot.averageCpuPercent,
    2
  );
});


test("resource profile stays heartbeat-scoped instead of bloating every telemetry event", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "main.js"),
    "utf8"
  );

  assert.match(
    mainSource,
    /function buildRuntimeMetadata\([\s\S]*includeResourceProfile = false/
  );
  assert.match(
    mainSource,
    /includeResourceProfile[\s\S]*buildResourceTelemetryProfile\(\)[\s\S]*: undefined/
  );
  assert.match(
    mainSource,
    /emitWatcherTelemetry\("heartbeat"[\s\S]*includeResourceProfile: true/
  );
});


test("remote resource heartbeat uses a compact support profile instead of the full local snapshot", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "main.js"),
    "utf8"
  );

  const helperStart =
    mainSource.indexOf(
      "function buildResourceTelemetryProfile()"
    );
  const metadataStart =
    mainSource.indexOf(
      "function buildRuntimeMetadata",
      helperStart
    );
  const helper =
    helperStart >= 0 &&
    metadataStart > helperStart
      ? mainSource.slice(
          helperStart,
          metadataStart
        )
      : "";

  assert.match(helper, /cpuPercent/);
  assert.match(helper, /workingSetMb/);
  assert.match(helper, /idleWakeupsPerSecond/);
  assert.match(helper, /networkMbps/);
  assert.match(helper, /powerSignal/);
  assert.doesNotMatch(helper, /processTypes/);
  assert.doesNotMatch(helper, /replayUploadBytes/);
  assert.doesNotMatch(helper, /streamUploadBytes/);
});
