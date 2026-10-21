"use strict";
// Exact byte-integrity tests for diagnostic queue corruption; never replay files.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {createDurableTelemetryQueue}=require("../telemetryQueue");
function temp() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-utf8-damage-"));
 return {dir,filePath:path.join(dir,"queue.json")};
}
test("invalid UTF-8 inside otherwise valid JSON is never decoded with replacement or rewritten",async()=>{
 const f=temp();
 try {
  const original=Buffer.from(JSON.stringify([{
   id:"telemetry_00112233445566778899aabbccddeeff",
   queuedAtMs:Date.now(),payload:{event_type:"heartbeat",detail:"x"},
  }])+"\n","utf8");
  const marker=original.indexOf(Buffer.from('"x"'));
  assert.ok(marker>0);
  original[marker+1]=0xff; // malformed text *inside* a valid JSON string
  const onDisk=Buffer.from(original);
  fs.writeFileSync(f.filePath,onDisk);
  const queue=createDurableTelemetryQueue({filePath:f.filePath});
  const bad=e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE"&&e.message.includes("UTF-8");
  await assert.rejects(queue.size(),bad);
  await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),bad);
  await assert.rejects(queue.flush(async()=>({ok:true})),bad);
  assert.deepEqual(fs.readFileSync(f.filePath),onDisk);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test("valid multibyte UTF-8 diagnostic fields retain exact bytes and event ID through a retry",async()=>{
 const f=temp();
 try{
  const id="telemetry_ffeeddccbbaa99887766554433221100";
  const queue=createDurableTelemetryQueue({filePath:f.filePath});
  await queue.enqueue({id,eventType:"heartbeat",payload:{event_type:"heartbeat",detail:"français — 東 ⚔️"}});
  const before=fs.readFileSync(f.filePath);
  const seen=[];
  const fail=await queue.flush(async item=>{seen.push(item);return {ok:false,retryable:true};});
  assert.equal(fail.remaining,1);
  assert.deepEqual(fs.readFileSync(f.filePath),before);
  const restore=createDurableTelemetryQueue({filePath:f.filePath});
  const good=await restore.flush(async item=>{seen.push(item);return {ok:true};});
  assert.equal(good.delivered,1);
  assert.equal(seen[0].id,id);
  assert.deepEqual(seen[1].payload,seen[0].payload);
  assert.equal(fs.existsSync(f.filePath),false);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
