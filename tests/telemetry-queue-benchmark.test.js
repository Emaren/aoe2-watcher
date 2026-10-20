"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
test("reproducible telemetry microbenchmark preserves queue correctness and labels limitations",()=>{
  const script=path.join(__dirname,"..","scripts","benchmark-telemetry-queue.cjs");
  const run=spawnSync(process.execPath,[script,path.join(__dirname,"..","telemetryQueue.js"),"12"],{
    encoding:"utf8",timeout:30000,
  });
  assert.equal(run.status,0,run.stderr);
  const out=JSON.parse(run.stdout);
  assert.equal(out.schema,1);
  assert.equal(out.kind,"node-component-microbenchmark");
  assert.equal(out.iterations,12);
  assert.equal(out.delivered,12);
  assert.equal(out.remaining,0);
  assert.ok(Number.isFinite(out.durationMs)&&out.durationMs>=0);
  assert.ok(out.mainLoopActiveFraction>=0&&out.mainLoopActiveFraction<=1);
  assert.match(out.claim,/not actual app CPU/);
});
