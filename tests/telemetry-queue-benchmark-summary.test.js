"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {spawnSync}=require("node:child_process");
test("queue benchmark summarizer requires valid delivered 200-event receipts",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-benchmark-summary-"));
 try {
  const record=(durationMs)=>({schema:1,kind:"node-component-microbenchmark",iterations:200,
   delivered:200,remaining:0,durationMs,mainLoopActiveFraction:0.1,
   eventLoopDelayP95Ms:1,eventLoopDelayMaxMs:2,maxTimerLagMs:3,rssDeltaMb:0});
  const a=path.join(dir,"a.jsonl"),b=path.join(dir,"b.jsonl");
  fs.writeFileSync(a,JSON.stringify(record(20))+"\n"+JSON.stringify(record(30))+"\n");
  fs.writeFileSync(b,JSON.stringify(record(10))+"\n"+JSON.stringify(record(15))+"\n");
  const script=path.join(__dirname,"..","scripts","summarize-telemetry-benchmark.cjs");
  const ok=spawnSync(process.execPath,[script,a,b],{encoding:"utf8"});
  assert.equal(ok.status,0,ok.stderr);
  assert.match(ok.stdout,/\| Duration \(ms\) \| 25 \| 12\.5 \|/);
  assert.match(ok.stdout,/not installed Watcher performance/);
  const tampered=record(20);tampered.delivered=199;
  fs.writeFileSync(a,JSON.stringify(tampered)+"\n"+JSON.stringify(record(30))+"\n");
  const bad=spawnSync(process.execPath,[script,a,b],{encoding:"utf8"});
  assert.equal(bad.status,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
