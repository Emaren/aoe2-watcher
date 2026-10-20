"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildProcessTopology,
  classifyPowerSignal,
  createResourceProfiler,
  isNewStreamChunkReceipt,
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

test("normal Electron helpers are distinguished from the application main process", () => {
  const topology = buildProcessTopology([
    { pid: 581, creationTime: 1000, type: "Browser" },
    { pid: 593, creationTime: 1001, type: "GPU", sandboxed: true },
    { pid: 594, creationTime: 1002, type: "Utility", sandboxed: true, name: "Network Service", serviceName: "network.mojom.NetworkService" },
    { pid: 595, creationTime: 1003, type: "Tab", sandboxed: true },
    { pid: 596, creationTime: 1004, type: "Tab", sandboxed: true },
  ]);

  assert.equal(topology.scope, "current-electron-application");
  assert.equal(topology.status, "observed");
  assert.equal(topology.browserProcessCount, 1);
  assert.equal(topology.helperProcessCount, 4);
  assert.equal(topology.unknownProcessCount, 0);
  assert.deepEqual(topology.processes.map((entry) => entry.role), [
    "main", "gpu", "utility", "renderer", "renderer",
  ]);
  assert.deepEqual(topology.processes.map((entry) => entry.expectedHelper), [
    false, true, true, true, true,
  ]);
  assert.equal(topology.processes[2].serviceName, "network.mojom.NetworkService");
  assert.match(topology.description, /helpers are normal Electron processes/);
  assert.match(topology.description, /does not prove global single-instance or orphan cleanup status/);
  assert.equal("duplicateInstance" in topology, false);
  assert.equal("orphaned" in topology, false);
});

test("topology diagnostics normalize optional fields without assuming sandbox state", () => {
  const topology = buildProcessTopology([
    null,
    [],
    "not a metric",
    {
      type: "Utility",
      pid: -1,
      creationTime: Infinity,
      sandboxed: "true",
      name: "  Network\nService\u0000  ",
      serviceName: "x".repeat(200),
    },
    { type: "future-process", pid: "594", creationTime: 0, name: 123 },
  ]);

  assert.equal(topology.processes.length, 2);
  assert.deepEqual(topology.processes[0], {
    pid: null,
    creationTime: null,
    type: "Utility",
    role: "utility",
    expectedHelper: true,
    sandboxed: null,
    name: "Network Service",
    serviceName: "x".repeat(160),
  });
  assert.equal(topology.processes[1].type, "Unknown");
  assert.equal(topology.processes[1].expectedHelper, false);
  assert.equal(topology.processes[1].pid, null);
  assert.equal(topology.unknownProcessCount, 1);
  assert.equal(topology.browserProcessCount, 0);
  assert.equal(buildProcessTopology(null).status, "unavailable");
  assert.equal(buildProcessTopology([]).status, "unavailable");
});

test("resource snapshots expose only the latest observed topology and retain PID creation identity", () => {
  let metrics = [
    { type: "Browser", pid: 581, creationTime: 1000 },
    { type: "Tab", pid: 595, creationTime: 1001 },
  ];
  let timestamp = 2000;
  const profiler = createResourceProfiler({ getMetrics: () => metrics, now: () => timestamp });

  assert.equal(profiler.sample().processTopology.helperProcessCount, 1);
  metrics = [{ type: "Browser", pid: 581, creationTime: 1000 }];
  timestamp += 1000;
  assert.equal(profiler.sample().processTopology.helperProcessCount, 0);
  metrics.push({ type: "Tab", pid: 595, creationTime: 3000 });
  timestamp += 1000;
  const snapshot = profiler.sample();
  assert.equal(snapshot.processTopology.processes[1].pid, 595);
  assert.equal(snapshot.processTopology.processes[1].creationTime, 3000);
  assert.equal(snapshot.sampleCount, 3);
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
    /buildRuntimeMetadata\(config,\s*\{[\s\S]*includeResourceProfile:\s*eventType === "heartbeat"/
  );
  assert.match(
    mainSource,
    /emitWatcherTelemetry\(\s*"heartbeat",\s*\{\},\s*config\s*\)/
  );
  assert.doesNotMatch(
    mainSource,
    /emitWatcherTelemetry\("heartbeat"[\s\S]{0,300}includeResourceProfile: true/
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
  assert.doesNotMatch(helper, /processTopology/);
  assert.doesNotMatch(helper, /replayUploadBytes/);
  assert.doesNotMatch(helper, /streamUploadBytes/);
});

test("transfer counters explicitly identify acknowledged logical payload rather than NIC throughput",()=>{
  const src=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
  const profileSource=fs.readFileSync(path.join(__dirname,"..","resourceProfile.js"),"utf8");
  const start=src.indexOf("function handleWatcherRuntimeEvent(event)");
  const end=src.indexOf("function focusMain",start);
  assert.ok(start>0 && end>start);
  const handler=src.slice(start,end);
  assert.match(handler,/event\?\.type === "upload-success"/);
  assert.doesNotMatch(handler,/event\?\.type === "upload-start"/);
  assert.match(src,/resourceProfiler\.recordNetworkBytes\(buffer\.length, "stream"\)/);
  assert.match(src,/networkMeasurement: profile\.networkMeasurement/);
  assert.match(profileSource,/http-acknowledged-payload-estimate/);
});
test("unacknowledged transfers never enter the acknowledged-byte accounting",()=>{
  let clock=0;
  const profiler=createResourceProfiler({
    now:()=>clock,
    getMetrics:()=>[{type:"Browser",cpu:{percentCPUUsage:0},memory:{workingSetSize:1024}}],
    getWorkload:()=>({monitorArmed:true}),
  });
  profiler.sample();
  clock=10_000;
  profiler.sample();
  let state=profiler.getSnapshot();
  assert.equal(state.networkMbps,0);
  assert.equal(state.networkMeasurement,"http-acknowledged-payload-estimate");
  profiler.recordNetworkBytes(2_000_000,"replay");
  clock=20_000;
  profiler.sample();
  state=profiler.getSnapshot();
  assert.equal(state.networkBytesThisSample,2_000_000);
  assert.equal(state.replayUploadBytes,2_000_000);
  assert.equal(state.networkMbps,1.6);
});

test("media accounting requires actual newly created stream chunk receipt",()=>{
  assert.equal(isNewStreamChunkReceipt({stream:{id:14},chunkCreated:true}),true);
  assert.equal(isNewStreamChunkReceipt({stream:{id:14},chunkCreated:false}),false);
  assert.equal(isNewStreamChunkReceipt({finality:"replay_final"}),false);
  assert.equal(isNewStreamChunkReceipt({stream:{id:14}}),false);
  assert.equal(isNewStreamChunkReceipt({chunkCreated:true}),false);
  assert.equal(isNewStreamChunkReceipt(null),false);
  const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
  assert.match(main,/if \(isNewStreamChunkReceipt\(response\.data\)\)/);
});
