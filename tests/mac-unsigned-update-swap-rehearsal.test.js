"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {spawn}=require("node:child_process");
const {qualifySandbox,rehearseMacAppSwap}=require("../macUnsignedUpdateSwapRehearsal");
const SKIP=process.platform==="win32"||!fs.constants.O_NOFOLLOW;
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-swap-rehearsal-"));
 fs.chmodSync(root,0o700);
 for(const name of ["installed","staged","backup"])fs.mkdirSync(path.join(root,name),{mode:0o700});
 for(const [where,value] of [["installed","1.6.5"],["staged","1.6.6"]]){
   const app=path.join(root,where,"AoE2HDBets Watcher.app");
   fs.mkdirSync(app,{mode:0o700});
   fs.writeFileSync(path.join(app,"VERSION"),value,{mode:0o600});
 }
 const version=()=>fs.readFileSync(path.join(root,"installed","AoE2HDBets Watcher.app","VERSION"),"utf8");
 const exists=name=>fs.existsSync(path.join(root,name,"AoE2HDBets Watcher.app"));
 const run=overrides=>rehearseMacAppSwap({
   sandboxRoot:root,assertProcessExited:async()=>true,
   assertReplacementHealthy:async p=>
     fs.readFileSync(path.join(p,"VERSION"),"utf8")==="1.6.6",
   ...overrides,
 });
 return {root,version,exists,run,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("sandbox-only swap keeps the known-good app backup through validated activation",{skip:SKIP},async()=>{
 const f=fixture();try{
  const result=await f.run();
  assert.equal(result.ok,true);
  assert.equal(result.backupRetained,true);
  assert.equal(f.version(),"1.6.6");
  assert.equal(f.exists("backup"),true);
  assert.equal(fs.readFileSync(path.join(f.root,"backup","AoE2HDBets Watcher.app","VERSION"),"utf8"),"1.6.5");
  assert.equal(f.exists("staged"),false);
 }finally{f.close();}
});
test("no process-exit witness means no backup or replacement",{skip:SKIP},async()=>{
 const f=fixture();try{
  await assert.rejects(f.run({assertProcessExited:async()=>false}),/process_not_confirmed_exited/);
  assert.equal(f.version(),"1.6.5");
  assert.equal(f.exists("backup"),false);
  assert.equal(f.exists("staged"),true);
 }finally{f.close();}
});
test("injected interruption before or after old-app backup restores the original",{skip:SKIP},async()=>{
 for(const phase of ["before_backup","after_backup"]){
  const f=fixture();try{
    await assert.rejects(f.run({faultAt:phase}),/injected_/);
    assert.equal(f.version(),"1.6.5");
    assert.equal(f.exists("backup"),false);
    assert.equal(f.exists("staged"),true);
  }finally{f.close();}
 }
});
test("injected interruption after swap restores original while preserving failed candidate",{skip:SKIP},async()=>{
 const f=fixture();try{
  await assert.rejects(f.run({faultAt:"after_swap"}),/injected_swap_failure/);
  assert.equal(f.version(),"1.6.5");
  assert.equal(f.exists("backup"),false);
  assert.equal(fs.readFileSync(path.join(f.root,"staged","rejected-upgrade.app","VERSION"),"utf8"),"1.6.6");
 }finally{f.close();}
});
test("unhealthy new binary triggers rollback even when file swap succeeded",{skip:SKIP},async()=>{
 const f=fixture();try{
  await assert.rejects(f.run({assertReplacementHealthy:async()=>false}),/health_failed/);
  assert.equal(f.version(),"1.6.5");
  assert.equal(f.exists("backup"),false);
  assert.equal(fs.readFileSync(path.join(f.root,"staged","rejected-upgrade.app","VERSION"),"utf8"),"1.6.6");
 }finally{f.close();}
});
test("external/symlink sandbox roots and pre-existing backups cannot be replaced",{skip:SKIP},async()=>{
 const f=fixture();const other=fs.mkdtempSync(path.join(os.tmpdir(),"not-an-app-"));
 try{
  await assert.rejects(qualifySandbox("/Applications/AoE2HDBets Watcher.app"),/not_a_disposable_rehearsal_root/);
  const alias=path.join(other,"watcher-swap-rehearsal-link");
  fs.symlinkSync(f.root,alias);
  await assert.rejects(qualifySandbox(alias),/non-directory_or_symlink/);
  fs.mkdirSync(path.join(f.root,"backup","AoE2HDBets Watcher.app"));
  await assert.rejects(f.run(),/backup_already_exists/);
  assert.equal(f.version(),"1.6.5");
 }finally{f.close();fs.rmSync(other,{recursive:true,force:true});}
});
test("stale lock cannot be silently stolen; filesystem remains untouched",{skip:SKIP},async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.root,".swap-rehearsal.lock"),"simulated crash");
  await assert.rejects(f.run(),/existing_or_stale_lock/);
  assert.equal(f.version(),"1.6.5");
  assert.equal(f.exists("backup"),false);
 }finally{f.close();}
});
test("rehearsal contains no untrusted network, subprocess, installer, or broad cleanup interface",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","macUnsignedUpdateSwapRehearsal.js"),"utf8");
 assert.doesNotMatch(source,/require\(["'](?:node:)?(?:child_process|https|electron)["']\)/);
 assert.doesNotMatch(source,/quitAndInstall|spctl|xattr|sudo|extractZip/);
 assert.match(source,/watcher-swap-rehearsal-/);
});

test("SIGKILL after swap retains both versions and a stale lock rather than claiming installation success",{skip:SKIP,timeout:25000},async()=>{
 const f=fixture();
 const childProgram=[
  'const {rehearseMacAppSwap}=require(' + JSON.stringify(path.join(__dirname,"..","macUnsignedUpdateSwapRehearsal.js")) + ');',
  'rehearseMacAppSwap({',
  'sandboxRoot:process.argv[1],',
  'assertProcessExited:async()=>true,',
  'assertReplacementHealthy:async()=>{',
  'process.send({checkpoint:"swapped_candidate_pending_health"});',
  'setInterval(()=>{},1000);',
  'return new Promise(()=>{});',
  '}}).catch(e=>{console.error(e);process.exitCode=1;});'
 ].join("\n");
 const child=spawn(process.execPath,["-e",childProgram,f.root],{
   stdio:["ignore","pipe","pipe","ipc"],
 });
 try{
  let deadline;
  const timeout = new Promise((_,reject)=>{
    deadline=setTimeout(()=>reject(new Error("No swap checkpoint within 12 seconds")),12000);
  });
  let message;
  try {
    message=await Promise.race([
      new Promise((resolve,reject)=>{
        child.once("message",resolve);
        child.once("error",reject);
        child.once("exit",()=>reject(new Error("Rehearsal exited before health checkpoint")));
      }),
      timeout,
    ]);
  } finally {clearTimeout(deadline);}
  assert.equal(message.checkpoint,"swapped_candidate_pending_health");
  child.kill("SIGKILL");
  await new Promise(resolve=>child.once("exit",resolve));
  assert.equal(f.version(),"1.6.6","new app was present at interruption");
  assert.equal(fs.readFileSync(path.join(f.root,"backup","AoE2HDBets Watcher.app","VERSION"),"utf8"),"1.6.5");
  assert.equal(fs.existsSync(path.join(f.root,".swap-rehearsal.lock")),true);
  await assert.rejects(f.run(),/existing_or_stale_lock/,
    "restart must refuse to overwrite backup or assume success");
  assert.equal(f.version(),"1.6.6");
  assert.equal(f.exists("backup"),true);
 }finally{
   if(child.exitCode===null)child.kill("SIGKILL");
   f.close();
 }
});
