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


test("damaged UTF-8 inside an otherwise valid transaction envelope is preserved byte-for-byte",{skip},async()=>{
 const dir=fixture();
 try{
  await createMacUpdateJournal(dir,initial());
  const filename=path.join(dir,"update-transaction.json");
  const original=fs.readFileSync(filename);
  const at=original.indexOf(Buffer.from('"1.6.6"'));
  assert.ok(at>0);
  original[at+1]=0xff;
  fs.writeFileSync(filename,original);
  await assert.rejects(readMacUpdateJournal(dir),/corrupt_utf8_or_json/);
  await assert.rejects(advanceMacUpdateJournal(dir,{
   expectedSequence:0,nextState:"bundle_verified",evidence:"verified_bundle_0001"
  }),/corrupt_utf8_or_json/);
  assert.deepEqual(fs.readFileSync(filename),original);
  assert.equal(fs.existsSync(path.join(dir,"update-transaction.lock")),false);
 }finally{clean(dir)}
});

test("concurrent journal append after opened-handle stat refuses without overwriting evidence",{skip},async()=>{
 const dir=fixture();
 const originalOpen=fs.promises.open;
 let injected=0;
 try{
  await createMacUpdateJournal(dir,initial());
  const filename=path.join(dir,"update-transaction.json");
  fs.promises.open=async function(...args){
   const handle=await originalOpen.apply(fs.promises,args);
   if(args[0]===filename){
    const stat=handle.stat.bind(handle);let first=true;
    handle.stat=async function(...statArgs){
     const snapshot=await stat(...statArgs);
     if(first){
      first=false;injected++;
      fs.appendFileSync(filename," ");
     }
     return snapshot;
    };
   }
   return handle;
  };
  await assert.rejects(readMacUpdateJournal(dir),
    /journal_changed_during_bounded_read/);
  assert.equal(injected,1);
  const raw=fs.readFileSync(filename,"utf8");
  assert.ok(raw.endsWith("\n "));
 }finally{
  fs.promises.open=originalOpen;
  clean(dir);
 }
});

test("journal FIFO open cannot hang without a writer on POSIX",{skip,timeout:8000},async()=>{
 const {spawnSync}=require("node:child_process");
 const dir=fixture();
 try{
  const filename=path.join(dir,"update-transaction.json");
  const made=spawnSync("mkfifo",[filename],{encoding:"utf8",timeout:3000});
  if(made.error?.code==="ENOENT")return;
  assert.equal(made.status,0,made.stderr);
  const code=[
   'const {readMacUpdateJournal}=require(process.argv[1]);',
   'readMacUpdateJournal(process.argv[2])',
   '.then(()=>{console.error("FIFO was incorrectly accepted");process.exitCode=25;},',
   'e=>{if(!/file_type_or_size/.test(e.message)){console.error(e);process.exitCode=26;}});',
  ].join("\n");
  const child=spawnSync(process.execPath,["-e",code,
   path.join(__dirname,"..","macUnsignedUpdateJournal.js"),dir],{
    encoding:"utf8",timeout:3000,windowsHide:true,
   });
  assert.equal(child.error,undefined,String(child.error));
  assert.equal(child.status,0,child.stderr);
  assert.equal(fs.lstatSync(filename).isFIFO(),true);
 }finally{clean(dir)}
});
