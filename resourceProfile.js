"use strict";

const DEFAULT_RESOURCE_SAMPLE_MS = 15 * 1000;
const DEFAULT_RESOURCE_WINDOW_SAMPLES = 8;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(finiteNumber(value) * scale) / scale;
}

function summarizeAppMetrics(metrics = []) {
  const summary = {
    processCount: 0,
    cpuPercent: 0,
    workingSetMb: 0,
    privateMemoryMb: 0,
    peakWorkingSetMb: 0,
    idleWakeupsPerSecond: 0,
    processTypes: {},
  };

  for (const metric of Array.isArray(metrics) ? metrics : []) {
    if (!metric || typeof metric !== "object") continue;

    summary.processCount += 1;
    const type = String(metric.type || "Unknown");
    summary.processTypes[type] =
      (summary.processTypes[type] || 0) + 1;

    summary.cpuPercent +=
      finiteNumber(metric.cpu?.percentCPUUsage);
    summary.idleWakeupsPerSecond +=
      finiteNumber(metric.cpu?.idleWakeupsPerSecond);

    // Electron reports these memory values in KiB.
    summary.workingSetMb +=
      finiteNumber(metric.memory?.workingSetSize) / 1024;
    summary.privateMemoryMb +=
      finiteNumber(metric.memory?.privateBytes) / 1024;
    summary.peakWorkingSetMb +=
      finiteNumber(metric.memory?.peakWorkingSetSize) / 1024;
  }

  summary.cpuPercent = round(summary.cpuPercent, 2);
  summary.workingSetMb = round(summary.workingSetMb, 1);
  summary.privateMemoryMb = round(summary.privateMemoryMb, 1);
  summary.peakWorkingSetMb =
    round(summary.peakWorkingSetMb, 1);
  summary.idleWakeupsPerSecond =
    round(summary.idleWakeupsPerSecond, 1);

  return summary;
}

function classifyPowerSignal({
  cpuPercent = 0,
  idleWakeupsPerSecond = 0,
  streamActive = false,
  importRunning = false,
  uploadActive = false,
} = {}) {
  const cpu = finiteNumber(cpuPercent);
  const wakeups =
    finiteNumber(idleWakeupsPerSecond);

  if (streamActive) {
    return {
      key: "streaming",
      label: "Streaming",
      detail:
        "Video capture is active; this is intentionally a heavier workload than replay watching.",
    };
  }

  if (cpu >= 15 || wakeups >= 250) {
    return {
      key: "high",
      label: "High",
      detail:
        "Watcher CPU or processor wakeups are elevated and should be inspected.",
    };
  }

  if (
    importRunning ||
    uploadActive ||
    cpu >= 4 ||
    wakeups >= 80
  ) {
    return {
      key: "active",
      label: "Active",
      detail:
        "Replay work is active; resource use should fall again when the transfer settles.",
    };
  }

  if (cpu >= 1.5 || wakeups >= 25) {
    return {
      key: "light",
      label: "Light",
      detail:
        "The Watcher is doing light background work.",
    };
  }

  return {
    key: "gentle",
    label: "Gentle",
    detail:
      "CPU and wakeup activity are in the Watcher's intended background range.",
  };
}

function createResourceProfiler({
  getMetrics = () => [],
  getWorkload = () => ({}),
  now = () => Date.now(),
  windowSamples = DEFAULT_RESOURCE_WINDOW_SAMPLES,
} = {}) {
  const maxSamples =
    Math.max(2, Math.floor(finiteNumber(windowSamples, 8)));

  let samples = [];
  let previousSampleAt = null;
  let previousNetworkBytes = 0;
  let totalNetworkBytes = 0;
  let replayUploadBytes = 0;
  let streamUploadBytes = 0;
  let sessionPeakCpuPercent = 0;
  let sessionPeakWorkingSetMb = 0;

  function recordNetworkBytes(bytes, kind = "other") {
    const amount =
      Math.max(0, Math.floor(finiteNumber(bytes)));

    totalNetworkBytes += amount;

    if (kind === "replay") {
      replayUploadBytes += amount;
    } else if (kind === "stream") {
      streamUploadBytes += amount;
    }

    return totalNetworkBytes;
  }

  function sample() {
    const sampledAtMs = now();
    let metrics = [];

    try {
      metrics = getMetrics() || [];
    } catch {
      metrics = [];
    }

    let workload = {};
    try {
      workload = getWorkload() || {};
    } catch {
      workload = {};
    }

    const summary =
      summarizeAppMetrics(metrics);

    const elapsedSeconds =
      previousSampleAt === null
        ? 0
        : Math.max(
            0,
            (sampledAtMs - previousSampleAt) /
              1000
          );

    const networkDeltaBytes =
      Math.max(
        0,
        totalNetworkBytes -
          previousNetworkBytes
      );

    const networkMbps =
      elapsedSeconds > 0
        ? round(
            (networkDeltaBytes * 8) /
              elapsedSeconds /
              1_000_000,
            3
          )
        : 0;

    previousSampleAt = sampledAtMs;
    previousNetworkBytes =
      totalNetworkBytes;

    sessionPeakCpuPercent =
      Math.max(
        sessionPeakCpuPercent,
        summary.cpuPercent
      );
    sessionPeakWorkingSetMb =
      Math.max(
        sessionPeakWorkingSetMb,
        summary.workingSetMb
      );

    const powerSignal =
      classifyPowerSignal({
        cpuPercent:
          summary.cpuPercent,
        idleWakeupsPerSecond:
          summary.idleWakeupsPerSecond,
        streamActive:
          Boolean(workload.streamActive),
        importRunning:
          Boolean(workload.importRunning),
        uploadActive:
          Boolean(workload.uploadActive),
      });

    const next = {
      sampledAt:
        new Date(sampledAtMs).toISOString(),
      ...summary,
      networkMbps,
      networkBytesThisSample:
        networkDeltaBytes,
      workload: {
        streamActive:
          Boolean(workload.streamActive),
        importRunning:
          Boolean(workload.importRunning),
        uploadActive:
          Boolean(workload.uploadActive),
        activeReplay:
          Boolean(workload.activeReplay),
      },
      powerSignal,
    };

    samples.push(next);
    if (samples.length > maxSamples) {
      samples =
        samples.slice(-maxSamples);
    }

    return getSnapshot();
  }

  function average(key, digits = 2) {
    if (!samples.length) return 0;

    return round(
      samples.reduce(
        (sum, entry) =>
          sum +
          finiteNumber(entry[key]),
        0
      ) / samples.length,
      digits
    );
  }

  function getSnapshot() {
    const current =
      samples[samples.length - 1] || {
        sampledAt: null,
        ...summarizeAppMetrics([]),
        networkMbps: 0,
        networkBytesThisSample: 0,
        workload: {
          streamActive: false,
          importRunning: false,
          uploadActive: false,
          activeReplay: false,
        },
        powerSignal:
          classifyPowerSignal(),
      };

    return {
      ...current,
      averageCpuPercent:
        average("cpuPercent", 2),
      averageIdleWakeupsPerSecond:
        average(
          "idleWakeupsPerSecond",
          1
        ),
      averageNetworkMbps:
        average("networkMbps", 3),
      sessionPeakCpuPercent:
        round(
          sessionPeakCpuPercent,
          2
        ),
      sessionPeakWorkingSetMb:
        round(
          sessionPeakWorkingSetMb,
          1
        ),
      sessionNetworkBytes:
        totalNetworkBytes,
      replayUploadBytes,
      streamUploadBytes,
      sampleCount: samples.length,
      sampleWindowSeconds:
        samples.length > 1
          ? Math.max(
              0,
              (Date.parse(
                samples[
                  samples.length - 1
                ].sampledAt
              ) -
                Date.parse(
                  samples[0].sampledAt
                )) /
                1000
            )
          : 0,

      // Portable per-process watt measurement is not exposed by Electron.
      // Do not turn a CPU/wakeup proxy into fake watts.
      powerWatts: null,
      powerMeasurement:
        "cpu-and-wakeup-proxy",
    };
  }

  return {
    getSnapshot,
    recordNetworkBytes,
    sample,
  };
}

module.exports = {
  DEFAULT_RESOURCE_SAMPLE_MS,
  DEFAULT_RESOURCE_WINDOW_SAMPLES,
  classifyPowerSignal,
  createResourceProfiler,
  summarizeAppMetrics,
};
