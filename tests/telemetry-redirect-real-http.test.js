"use strict";

// Actual Axios/HTTP transport regression on two disposable loopback servers.
// Diagnostic telemetry only: no public host, real API key, replay or media.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const http=require("node:http");
const vm=require("node:vm");
const test=require("node:test");
const axios=require("axios");
const {createDurableTelemetryQueue}=require("../telemetryQueue");
const {assertWatcherTelemetryAck}=require("../telemetryDelivery");

const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
function extract(start,end){
 const from=main.indexOf(start),to=main.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,"telemetry function anchors must exist");
 return main.slice(from,to);
}
const runtime=[
 extract("function isRetryableTelemetryError(","function getDurableTelemetryQueue()"),
 extract("async function flushWatcherTelemetryQueue(","async function postWatcherTelemetry("),
 extract("async function postWatcherTelemetry(","function emitWatcherTelemetry("),
].join("\n");
async function bind(server){
 await new Promise((resolve,reject)=>{
  server.once("error",reject);
  server.listen(0,"127.0.0.1",resolve);
 });
 return "http://127.0.0.1:"+server.address().port;
}
async function close(server){
 if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}

test("actual 307 HTTP server cannot receive redirected Watcher telemetry credentials or consume the queued ID",
 {timeout:15000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-166-redirect-http-"));
 const queue=createDurableTelemetryQueue({filePath:path.join(dir,"pending.json")});
 const id="telemetry_11223344556677889900aabbccddeeff";
 const sensitive="disposable-ci-telemetry-key";
 const seenAtDestination=[];
 const seenAtOrigin=[];
 let allowSuccess=false;
 const destination=http.createServer((req,res)=>{
  seenAtDestination.push({path:req.url,key:req.headers["x-api-key"]});
  req.resume();
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify({ok:true,stored:1,suppressed:0,failed:0}));
 });
 const origin=http.createServer((req,res)=>{
  const pieces=[];
  req.on("data",part=>pieces.push(part));
  req.on("end",()=>{
   const body=JSON.parse(Buffer.concat(pieces).toString("utf8"));
   seenAtOrigin.push({path:req.url,key:req.headers["x-api-key"],id:body.metadata.telemetryEventId});
   if(allowSuccess){
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({ok:true,stored:1,suppressed:0,failed:0}));
   }else{
    res.writeHead(307,{location:destUrl+"/leak"});
    res.end();
   }
  });
 });
 let destUrl;
 try{
  destUrl=await bind(destination);
  const originUrl=await bind(origin);
  const config={uploadApiKey:sensitive};
  const context={
   console:{warn:()=>{},log:()=>{}},
   loadConfig:()=>config,
   getTelemetryBaseUrl:()=>originUrl,
   createRandomId:()=>id,
   buildTelemetryPayload:(eventType,payload)=>({eventType,...payload}),
   getDurableTelemetryQueue:()=>queue,
   assertWatcherTelemetryAck,
   TELEMETRY_TIMEOUT_MS:4000,
   axios,
  };
  vm.createContext(context);
  vm.runInContext(runtime+"\nglobalThis.api={send:postWatcherTelemetry,flush:flushWatcherTelemetryQueue};",context);
  assert.equal(await context.api.send("heartbeat",{}, {wait:true,config}),null);
  assert.equal(await queue.size(),1);
  assert.equal(seenAtDestination.length,0,"redirect target must not be contacted");
  assert.deepEqual(seenAtOrigin.map(x=>x.id),[id]);
  assert.equal(seenAtOrigin[0].key,sensitive);
  const before=JSON.parse(fs.readFileSync(path.join(dir,"pending.json"),"utf8"));
  assert.equal(before.length,1);
  assert.equal(before[0].id,id);
  const first=await context.api.flush(config);
  assert.equal(first.delivered,0);
  assert.equal(first.remaining,1);
  assert.equal(await queue.size(),1);
  assert.equal(seenAtDestination.length,0);
  allowSuccess=true;
  const second=await context.api.flush(config);
  assert.equal(second.delivered,1);
  assert.equal(second.remaining,0);
  assert.deepEqual(seenAtOrigin.map(x=>x.id),[id,id,id]);
  assert.equal(seenAtDestination.length,0);
  assert.equal(fs.existsSync(path.join(dir,"pending.json")),false);
 }finally{
  await Promise.allSettled([close(origin),close(destination)]);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
