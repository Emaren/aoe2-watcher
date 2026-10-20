"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const {createDurableTelemetryQueue}=require("../telemetryQueue");
const {assertWatcherTelemetryAck}=require("../telemetryDelivery");

const source=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
function slice(begin,end) {
 const i=source.indexOf(begin),j=source.indexOf(end,i+begin.length);
 assert.ok(i>=0&&j>i,"actual runtime functions must exist");
 return source.slice(i,j);
}
const runtime=[
  slice("function isRetryableTelemetryError(","function getDurableTelemetryQueue()"),
  slice("async function flushWatcherTelemetryQueue(","async function postWatcherTelemetry("),
  slice("async function postWatcherTelemetry(","function emitWatcherTelemetry("),
].join("\n");

function harness(queue,responses) {
 const calls=[],warnings=[];
 const config={uploadApiKey:"watcher-testing-key"};
 const context={
   console:{warn:(...args)=>warnings.push(args.join(" ")),log:()=>{}},
   loadConfig:()=>config,getTelemetryBaseUrl:()=>"https://site.example",
   createRandomId:()=>"telemetry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
   buildTelemetryPayload:(eventType,payload)=>({eventType,...payload}),
   getDurableTelemetryQueue:()=>queue,
   assertWatcherTelemetryAck,
   TELEMETRY_TIMEOUT_MS:8000,
   axios:{post:async(url,payload,options)=>{
     calls.push({url,payload,options});
     const reply=responses.shift();
     if(reply instanceof Error)throw reply;
     if(!reply)throw Error("No mock response");
     return {data:reply};
   }},
 };
 vm.createContext(context);
 vm.runInContext(runtime+"\n globalThis.api={send:postWatcherTelemetry,flush:flushWatcherTelemetryQueue};",context,{
   filename:"main.js telemetry sender slice",
 });
 return {calls,warnings,config,api:context.api};
}
function temp() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-http-ack-integration-"));
 return {dir,path:path.join(dir,"queue.json")};
}
test("real send path queues HTTP 200+failed and retires only upon actual stored ACK",async()=>{
 const f=temp();
 try{
  const queue=createDurableTelemetryQueue({filePath:f.path});
  const h=harness(queue,[{ok:true,stored:0,suppressed:0,failed:1},{ok:true,stored:1,suppressed:0,failed:0}]);
  assert.equal(await h.api.send("heartbeat",{metadata:{context:"test"}},{wait:true,config:h.config}),null);
  assert.equal(await queue.size(),1);
  assert.equal(h.calls[0].payload.metadata.telemetryEventId,"telemetry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(h.calls[0].options.headers["x-api-key"],"watcher-testing-key");
  assert.equal((await h.api.flush(h.config)).delivered,1);
  assert.equal(await queue.size(),0);
  assert.equal(JSON.stringify(h.calls[0].payload),JSON.stringify(h.calls[1].payload),"retry must send immutable original event ID and metadata across the VM and persisted JSON realms");
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("HTTP 503 retries but HTTP 400 remains rejected without persistent queue churn",async()=>{
 const f=temp();
 try{
  const queue=createDurableTelemetryQueue({filePath:f.path});
  const serverError=new Error("Service unavailable");
  serverError.response={status:503,statusText:"Service Unavailable"};
  const validationError=new Error("Bad request");
  validationError.response={status:400,statusText:"Bad Request"};
  const h=harness(queue,[serverError,validationError]);
  assert.equal(await h.api.send("upload_failed",{}, {wait:true,config:h.config}),null);
  assert.equal(await queue.size(),1);
  assert.equal(await h.api.send("invalid_event",{}, {wait:true,config:h.config}),null);
  assert.equal(await queue.size(),1);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("unreadable diagnostic queue does not throw out of send or flush or overwrite original bytes",async()=>{
 const f=temp();
 try {
  fs.writeFileSync(f.path,"[broken-json", "utf8");
  const queue=createDurableTelemetryQueue({filePath:f.path});
  const fail=new Error("server offline");
  fail.response={status:503,statusText:"Offline"};
  const h=harness(queue,[fail]);
  assert.equal(await h.api.send("heartbeat",{}, {wait:true,config:h.config}),null);
  assert.equal((await h.api.flush(h.config)).queueError,true);
  assert.equal(fs.readFileSync(f.path,"utf8"),"[broken-json");
  assert.ok(h.warnings.some(x=>x.includes("could not be durably queued")));
  assert.ok(h.warnings.some(x=>x.includes("queue could not flush")));
 } finally {fs.rmSync(f.dir,{recursive:true,force:true})}
});
