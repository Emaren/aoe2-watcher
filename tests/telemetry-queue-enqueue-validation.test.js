"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const test=require("node:test");
const {createDurableTelemetryQueue}=require("../telemetryQueue");

test("malformed diagnostic enqueues never poison or rewrite the previously durable event",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-self-poison-"));
 const filePath=path.join(dir,"queue.json");
 try {
  const queue=createDurableTelemetryQueue({filePath});
  const accepted={id:"telemetry_00112233445566778899aabbccddeeff",
   eventType:"heartbeat",payload:{event_type:"heartbeat",locale:"français ⚔️"}};
  assert.equal(await queue.enqueue(accepted),1);
  const original=fs.readFileSync(filePath);
  const invalid=[
   null,
   undefined,
   [],
   "heartbeat",
   {eventType:"heartbeat"},
   {eventType:"heartbeat",payload:null},
   {eventType:"heartbeat",payload:[]},
   {eventType:"heartbeat",payload:"invalid"},
   {eventType:"heartbeat",payload:{event_type:"heartbeat"},queuedAtMs:Infinity},
   {eventType:"heartbeat",payload:{event_type:"heartbeat"},queuedAtMs:0},
   {eventType:"heartbeat",payload:{event_type:"heartbeat"},queuedAtMs:-1},
   {eventType:"heartbeat",payload:{event_type:"heartbeat"},queuedAtMs:"not-a-time"},
   {eventType:"heartbeat",payload:{toJSON:()=>"scalar"}},
   {eventType:"heartbeat",payload:{event_type:"heartbeat",bad:1n}},
   {eventType:"heartbeat",payload:{event_type:"heartbeat"},
     toJSON:()=>({queuedAtMs:Date.now(),payload:"scalar"})},
  ];
  for(const entry of invalid) {
   await assert.rejects(queue.enqueue(entry),
    error=>error.code==="AOE2_TELEMETRY_QUEUE_INVALID_EVENT");
   assert.deepEqual(fs.readFileSync(filePath),original,
     "refused input must never mutate existing on-disk bytes");
   assert.equal(await queue.size(),1);
  }
  assert.equal(await queue.enqueue({id:"recovered",eventType:"heartbeat",
   payload:{event_type:"heartbeat",valid:true}}),2);
  const sent=[];
  const result=await queue.flush(async item=>{sent.push(item.id);return {ok:true};});
  assert.deepEqual(sent,[accepted.id,"recovered"]);
  assert.equal(result.delivered,2);
  assert.equal(fs.existsSync(filePath),false);
  assert.deepEqual(fs.readdirSync(dir).filter(x=>x.includes(".tmp-")),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test("numeric string historical enqueue timestamps normalize to a durable finite number",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-timestamp-coercion-"));
 const filePath=path.join(dir,"queue.json");
 try {
  const queue=createDurableTelemetryQueue({filePath});
  const millis=Date.now();
  assert.equal(await queue.enqueue({
   eventType:"heartbeat",queuedAtMs:String(millis),
   payload:{event_type:"heartbeat"},
  }),1);
  const rows=JSON.parse(fs.readFileSync(filePath,"utf8"));
  assert.equal(rows[0].queuedAtMs,millis);
  assert.equal(typeof rows[0].queuedAtMs,"number");
  assert.equal(await createDurableTelemetryQueue({filePath}).size(),1);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test("stateful toJSON cannot switch a previously validated diagnostic into poisoned JSON",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-stateful-serializer-"));
 const filePath=path.join(dir,"queue.json");
 try {
  let serializations=0;
  const queue=createDurableTelemetryQueue({filePath});
  const id="telemetry_aabbccddeeff00112233445566778899";
  const event={
   id,eventType:"heartbeat",payload:{event_type:"heartbeat"},
   toJSON(){
    serializations++;
    if(serializations===1)return {
     id,eventType:"heartbeat",queuedAtMs:Date.now(),
     payload:{event_type:"heartbeat",source:"first-canonical"},
    };
    return {id,queuedAtMs:"poisoned",payload:"second-mutated"};
   },
  };
  assert.equal(await queue.enqueue(event),1);
  assert.equal(serializations,1,"persist only the preflighted wire snapshot");
  const persisted=JSON.parse(fs.readFileSync(filePath,"utf8"));
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].id,id);
  assert.equal(persisted[0].payload.source,"first-canonical");
  assert.equal(await createDurableTelemetryQueue({filePath}).size(),1);
  const delivered=[];
  const result=await queue.flush(async item=>{
   delivered.push(item);
   return {ok:true};
  });
  assert.equal(result.delivered,1);
  assert.equal(delivered[0].id,id);
  assert.equal(delivered[0].payload.source,"first-canonical");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
