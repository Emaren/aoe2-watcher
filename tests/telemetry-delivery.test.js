"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const {classifyWatcherTelemetryAck,assertWatcherTelemetryAck}=require("../telemetryDelivery");
const classify=classifyWatcherTelemetryAck;

test("positive storage or deliberate coalescing independently acknowledges one event",()=>{
  assert.equal(classify({ok:true,stored:1,suppressed:0,failed:0}).reason,"stored");
  assert.equal(classify({ok:true,stored:0,suppressed:1,failed:0}).reason,"coalesced");
  assert.equal(classify({ok:true}).reason,"legacy_transport_acknowledgment");
});
test("2xx with failed writes must never retire the durable event",()=>{
  for(const reply of [
    {ok:true,stored:0,suppressed:0,failed:1},
    {ok:true,stored:1,suppressed:0,failed:1},
    {ok:false,stored:0,suppressed:0,failed:1},
    {ok:true,stored:0,suppressed:0,failed:0},
    {ok:true,stored:2,suppressed:0,failed:0},
    {ok:true,stored:1,failed:0},
    {ok:true,stored:-1,suppressed:2,failed:0},
    {ok:true,stored:"1",suppressed:0,failed:0},
    null,[],
  ]) {
    assert.equal(classify(reply).ok,false,JSON.stringify(reply));
    assert.throws(()=>assertWatcherTelemetryAck(reply),error=>
      error.code==="AOE2_TELEMETRY_ACK_UNCERTAIN" &&
      error.watcherTelemetryAckRetryable===true);
  }
});
test("both real queue flushing and immediate sends verify response bodies",()=>{
  const src=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
  const occurrences=src.match(/assertWatcherTelemetryAck\(response\.data\)/g)||[];
  assert.equal(occurrences.length,2);
  assert.match(src,/watcherTelemetryAckRetryable === true/);
  assert.match(src,/id: telemetryEventId/);
  assert.match(src,/payload:\s*telemetryPayload/);
});
