"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createResourceProfiler } = require("../resourceProfile");

test("bounded workload cohorts distinguish idle, monitor, replay and video without fabricating watts", () => {
  let tick = 1_000;
  let cpu = 0.4;
  let phase = {};
  const profiler = createResourceProfiler({
    now: () => tick,
    getWorkload: () => phase,
    getMetrics: () => [{
      type: "Browser",
      cpu: { percentCPUUsage: cpu, idleWakeupsPerSecond: 2 },
      memory: { workingSetSize: 64 * 1024, privateBytes: 42 * 1024 },
    }],
  });
  const sample = () => { tick += 10_000; return profiler.sample(); };
  sample();
  phase = { monitorArmed: true }; cpu = 1.2; sample();
  phase = { monitorArmed: true, activeReplay: true }; cpu = 2.3; sample();
  phase = { monitorArmed: true, uploadActive: true }; cpu = 4.1; sample();
  phase = { monitorArmed: true, streamActive: true }; cpu = 8.7; sample();
  const result = sample();
  assert.equal(result.workloadPhase, "streaming");
  const cohorts = Object.fromEntries(result.workloadCohorts.map(x => [x.phase, x]));
  assert.deepEqual(Object.keys(cohorts), ["idle","monitoring","game_detected","replay_transfer","streaming"]);
  assert.equal(cohorts.idle.avgCpuPercent, 0.4);
  assert.equal(cohorts.monitoring.avgCpuPercent, 1.2);
  assert.equal(cohorts.streaming.avgCpuPercent, 8.7);
  assert.equal(cohorts.streaming.samples, 2);
  assert.equal(cohorts.streaming.watts, null);
  assert.equal(result.powerWatts, null);
  assert.equal(result.powerMeasurement, "cpu-and-wakeup-proxy");
});

test("missing Electron process metrics are never counted as zero-CPU evidence", () => {
  const p = createResourceProfiler({ getMetrics: () => [], getWorkload: () => ({ monitorArmed: true }) });
  assert.deepEqual(p.sample().workloadCohorts, []);
});

test("watcher exposes only local resource cohorts, not user credentials or made-up wall power", () => {
  const main = fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
  const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const renderer = fs.readFileSync(path.join(__dirname,"..","renderer.js"),"utf8");
  assert.match(main, /monitorArmed:\s*Boolean\(watcherHandle\)/);
  assert.match(html, /id="resourceCohortsText"/);
  assert.match(renderer, /profile\.workloadCohorts/);
  assert.match(renderer, /formatResourcePercent\(cohort\.avgCpuPercent\)/);
  assert.doesNotMatch(renderer, /watts.*=\s*cohort\.avgCpuPercent/);
});
