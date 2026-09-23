"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyPowerSignal,
  createResourceProfiler,
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
