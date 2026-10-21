"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {boundedDiagnosticBytes}=require("../diagnosticLimits");

const MiB=1024*1024;
const rules=[
 ["RUNTIME_EVENT_JOURNAL_MAX_BYTES",{fallback:5*MiB,minimum:MiB,maximum:32*MiB}],
 ["RUNTIME_EVENT_JOURNAL_PENDING_MAX_BYTES",{fallback:MiB,minimum:256*1024,maximum:8*MiB}],
 ["RUNTIME_EVENT_JOURNAL_BUFFER_MAX_BYTES",{fallback:64*1024,minimum:8*1024,maximum:MiB}],
];

test("diagnostic disk and in-memory ceilings remain finite for invalid and extreme env overrides",()=>{
 for(const [name,policy] of rules){
  for(const raw of [undefined,null,""," ","NaN","Infinity","-Infinity",
   "-1",0,NaN,Infinity,-Infinity,"wrong",false]){
   assert.equal(boundedDiagnosticBytes(raw,policy),policy.fallback,
    name+" raw="+String(raw));
  }
  for(const raw of ["0.1","1","512",1,2]){
   assert.equal(boundedDiagnosticBytes(raw,policy),policy.minimum,
    name+" raw="+String(raw));
  }
  assert.equal(boundedDiagnosticBytes("9999999999999999",policy),
   policy.maximum,name+" huge override");
  assert.equal(boundedDiagnosticBytes(String(policy.minimum+1000),policy),
   policy.minimum+1000);
 }
 assert.throws(()=>boundedDiagnosticBytes("9000",
  {fallback:10,minimum:100,maximum:1000}),/invalid diagnostic byte-limit policy/);
});

test("Electron runtime uses safe finite limits for journal rotation, queued writes and RAM buffer",()=>{
 const src=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
 for(const [name] of rules){
  assert.match(src,new RegExp("const "+name+" = boundedDiagnosticBytes\\("));
 }
 assert.match(src,/require\("\.\/diagnosticLimits"\)/);
});
