"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createDurableTelemetryQueue}=require("../telemetryQueue");
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-telemetry-fsync-"));
 return {dir,filePath:path.join(dir,"events.json")};
}
const entry={id:"telemetry_00112233445566778899aabbccddeeff",
 eventType:"heartbeat",payload:{event_type:"heartbeat"}};

test("durable queue ACK follows temp file sync, atomic rename and POSIX parent directory sync",async()=>{
 const {dir,filePath}=fixture();
 const originalOpen=fs.promises.open,originalRename=fs.promises.rename;
 const steps=[];
 try{
  fs.promises.open=async function(...args){
   const handle=await originalOpen.apply(fs.promises,args);
   const isTemp=String(args[0]).startsWith(filePath+".tmp-");
   const isDirectory=String(args[0])===dir;
   if(isTemp||isDirectory){
    const sync=handle.sync.bind(handle);
    handle.sync=async function(...rest){
     steps.push(isTemp?"file_sync":"directory_sync");
     return sync(...rest);
    };
   }
   return handle;
  };
  fs.promises.rename=async function(...args){
   if(args[1]===filePath)steps.push("rename");
   return originalRename.apply(fs.promises,args);
  };
  const q=createDurableTelemetryQueue({filePath});
  assert.equal(await q.enqueue(entry),1);
  assert.ok(steps.includes("file_sync"));
  assert.ok(steps.includes("rename"));
  assert.ok(steps.indexOf("file_sync")<steps.indexOf("rename"));
  if(process.platform!=="win32"){
   assert.ok(steps.includes("directory_sync"));
   assert.ok(steps.indexOf("rename")<steps.indexOf("directory_sync"));
  }
  assert.equal((await q.size()),1);
 }finally{
  fs.promises.open=originalOpen;
  fs.promises.rename=originalRename;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test("failure to sync the temporary queue never replaces last known-good bytes",async()=>{
 const {dir,filePath}=fixture();
 const originalOpen=fs.promises.open;
 try{
  const q=createDurableTelemetryQueue({filePath});
  await q.enqueue(entry);
  const before=fs.readFileSync(filePath);
  let injected=0;
  fs.promises.open=async function(...args){
   const handle=await originalOpen.apply(fs.promises,args);
   if(String(args[0]).startsWith(filePath+".tmp-")){
    handle.sync=async()=>{injected++;const e=new Error("injected_file_sync_failure");e.code="EIO";throw e;};
   }
   return handle;
  };
  await assert.rejects(q.enqueue({id:"next",eventType:"heartbeat",
   payload:{event_type:"heartbeat"}}),/injected_file_sync_failure/);
  assert.equal(injected,1);
  assert.deepEqual(fs.readFileSync(filePath),before);
  assert.deepEqual(fs.readdirSync(dir),["events.json"]);
  assert.equal(await q.size(),1);
 }finally{
  fs.promises.open=originalOpen;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test("failed POSIX directory fsync after rename refuses success but preserves published bytes",
 {skip:process.platform==="win32"},async()=>{
 const {dir,filePath}=fixture();
 const originalOpen=fs.promises.open;
 try{
  const q=createDurableTelemetryQueue({filePath});
  let injected=0;
  fs.promises.open=async function(...args){
   const handle=await originalOpen.apply(fs.promises,args);
   if(String(args[0])===dir){
    handle.sync=async()=>{injected++;const e=new Error("injected_parent_sync_failure");e.code="EIO";throw e;};
   }
   return handle;
  };
  await assert.rejects(q.enqueue(entry),/injected_parent_sync_failure/);
  assert.equal(injected,1);
  const stored=JSON.parse(fs.readFileSync(filePath,"utf8"));
  assert.equal(stored.length,1);
  assert.equal(stored[0].id,entry.id);
  assert.deepEqual(fs.readdirSync(dir),["events.json"]);
  assert.equal(await q.size(),1);
 }finally{
  fs.promises.open=originalOpen;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
