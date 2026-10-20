"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {
  createMacUpdateJournal,advanceMacUpdateJournal,readMacUpdateJournal,
}=require("../macUnsignedUpdateJournal");
const {
  createMacUpdateTransaction,classifyMacUpdateRecovery,
}=require("../macUnsignedUpdateTransaction");
const skip=process.platform==="win32"||!fs.constants.O_NOFOLLOW;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-update-journal-"));
 fs.chmodSync(dir,0o700);
 return dir;
}
function initial(){return createMacUpdateTransaction({
 transactionId:"a".repeat(32),version:"1.6.6",
 artifactSha256:"b".repeat(64),sourceSha:"c".repeat(40),
});}
function clean(dir){fs.rmSync(dir,{recursive:true,force:true})}
test("journals every ordered state durably without changing installed applications",{skip},async()=>{
 const dir=fixture();
 try{
  const record=await createMacUpdateJournal(dir,initial());
  assert.equal(record.state,"archive_verified");
  let current=await advanceMacUpdateJournal(dir,{expectedSequence:0,
    nextState:"bundle_verified",evidence:"bundle_receipt_0001"});
  current=await advanceMacUpdateJournal(dir,{expectedSequence:1,
    nextState:"idle_confirmed",evidence:"idle_receipt_0002"});
  assert.equal(current.sequence,2);
  const restored=await readMacUpdateJournal(dir);
  assert.deepEqual(restored,current);
  assert.equal(classifyMacUpdateRecovery(restored),"DO_NOT_SWAP_OLD_APP_MAY_STILL_RUN");
  const names=fs.readdirSync(dir);
  assert.deepEqual(names,["update-transaction.json"]);
  assert.equal(fs.statSync(path.join(dir,names[0])).mode&0o077,0);
 }finally{clean(dir)}
});
test("stale or conflicting commits fail without modifying existing journal",{skip},async()=>{
 const dir=fixture();
 try{
  await createMacUpdateJournal(dir,initial());
  await advanceMacUpdateJournal(dir,{expectedSequence:0,
    nextState:"bundle_verified",evidence:"bundle_receipt_0001"});
  const before=fs.readFileSync(path.join(dir,"update-transaction.json"));
  await assert.rejects(createMacUpdateJournal(dir,initial()),/existing_transaction/);
  await assert.rejects(advanceMacUpdateJournal(dir,{expectedSequence:0,
    nextState:"idle_confirmed",evidence:"idle_receipt_0002"}),/concurrent_or_stale_transition/);
  assert.deepEqual(fs.readFileSync(path.join(dir,"update-transaction.json")),before);
 }finally{clean(dir)}
});
test("corrupted journal and symlink are rejected, not recovered as success",{skip},async()=>{
 const dir=fixture();
 try{
  await createMacUpdateJournal(dir,initial());
  const file=path.join(dir,"update-transaction.json");
  const obj=JSON.parse(fs.readFileSync(file,"utf8"));
  obj.record.state="committed";
  fs.writeFileSync(file,JSON.stringify(obj));
  await assert.rejects(readMacUpdateJournal(dir),/invalid_record/);
  const before=fs.readFileSync(file);
  await assert.rejects(advanceMacUpdateJournal(dir,{expectedSequence:0,
    nextState:"bundle_verified",evidence:"bundle_receipt_0001"}));
  assert.deepEqual(fs.readFileSync(file),before);
  fs.rmSync(file);
  const external=path.join(dir,"external");
  fs.writeFileSync(external,JSON.stringify(obj));
  fs.symlinkSync(external,file);
  await assert.rejects(readMacUpdateJournal(dir),error=>
    error?.code==="ELOOP"||error?.code==="AOE2_MAC_UPDATE_JOURNAL_REFUSED");
  assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
 }finally{clean(dir)}
});
test("stale lock prevents automatic takeover after a simulated helper crash",{skip},async()=>{
 const dir=fixture();
 try{
  await createMacUpdateJournal(dir,initial());
  const lock=path.join(dir,"update-transaction.lock");
  fs.writeFileSync(lock,"crashed helper");
  await assert.rejects(advanceMacUpdateJournal(dir,{expectedSequence:0,
    nextState:"bundle_verified",evidence:"bundle_receipt_0001"}),/active_or_stale_lock/);
  assert.equal(fs.readFileSync(lock,"utf8"),"crashed helper");
  assert.equal((await readMacUpdateJournal(dir)).state,"archive_verified");
 }finally{clean(dir)}
});
test("two concurrent transitions never both commit the same sequence",{skip},async()=>{
 const dir=fixture();
 try{
  await createMacUpdateJournal(dir,initial());
  const updates=await Promise.allSettled(Array.from({length:2},()=>advanceMacUpdateJournal(dir,{
    expectedSequence:0,nextState:"bundle_verified",evidence:"bundle_receipt_0001",
  })));
  assert.equal(updates.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(updates.filter(x=>x.status==="rejected").length,1);
  assert.equal((await readMacUpdateJournal(dir)).sequence,1);
 }finally{clean(dir)}
});
test("private stage required; no file writes can escape symlinked stage root",{skip},async()=>{
 const dir=fixture();
 try{
  const stage=path.join(dir,"symlink");
  fs.symlinkSync(dir,stage);
  await assert.rejects(createMacUpdateJournal(stage,initial()),/staging_not_private/);
  assert.deepEqual(fs.readdirSync(dir).sort(),["symlink"]);
  fs.unlinkSync(stage);
  fs.chmodSync(dir,0o755);
  await assert.rejects(createMacUpdateJournal(dir,initial()),/staging_not_private/);
 }finally{clean(dir)}
});
test("journal cannot run a shell, install, launch, elevate, or quit the Watcher",()=>{
 const text=fs.readFileSync(path.join(__dirname,"..","macUnsignedUpdateJournal.js"),"utf8");
 assert.doesNotMatch(text,/child_process|quitAndInstall|\.app"|spawn\(|exec\(/);
});
