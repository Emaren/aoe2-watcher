"use strict";

// Crash-aware journal for an eventual user-scoped Mac update helper.
// This module only manages a PRIVATE diagnostic journal in a staging folder.
// Never use a mutable local journal as release, process-exit, backup, or
// installed-health proof. It never touches an installed .app or launches one.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  validateMacUpdateTransaction,
  transitionMacUpdateTransaction,
}=require("./macUnsignedUpdateTransaction");

const NAME="update-transaction.json";
const LOCK="update-transaction.lock";
const MAX_BYTES=16384;

function deny(reason){
 const error=new Error("Mac update journal refused: "+reason);
 error.code="AOE2_MAC_UPDATE_JOURNAL_REFUSED";
 throw error;
}
function isObject(value){
 return Boolean(value && typeof value==="object"&&!Array.isArray(value));
}
function keysExactly(value,keys){
 return isObject(value)&&Object.keys(value).sort().join(",")===keys.slice().sort().join(",");
}
async function safeStageDir(dir){
 if(process.platform==="win32"||!fs.constants.O_NOFOLLOW)deny("mac_only");
 if(typeof dir!=="string"||!path.isAbsolute(dir)||dir.includes("\0")||
    path.normalize(dir)!==dir)deny("invalid_staging_path");
 const stat=await fs.promises.lstat(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077)deny("staging_not_private");
 if(typeof process.getuid==="function"&&stat.uid!==process.getuid())deny("staging_wrong_owner");
 return dir;
}
function seal(record){
 const bytes=JSON.stringify(record);
 const digest=crypto.createHash("sha256").update(bytes).digest("hex");
 return JSON.stringify({schema:1,record,digest})+"\n";
}
function parse(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX_BYTES)deny("invalid_length");
 let result;
 try{result=JSON.parse(bytes.toString("utf8"))}catch{deny("corrupt_json")}
 if(!keysExactly(result,["schema","record","digest"])||result.schema!==1||
    !validateMacUpdateTransaction(result.record)||
    typeof result.digest!=="string"||!/^[a-f0-9]{64}$/.test(result.digest))deny("invalid_record");
 const expected=crypto.createHash("sha256").update(JSON.stringify(result.record)).digest();
 if(!crypto.timingSafeEqual(expected,Buffer.from(result.digest,"hex")))deny("corrupt_checksum");
 return result.record;
}
async function readUnlocked(dir){
 let file;
 try{
   file=await fs.promises.open(path.join(dir,NAME),
     fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   const stat=await file.stat();
   if(!stat.isFile()||stat.size<=0||stat.size>MAX_BYTES)deny("file_type_or_size");
   const bytes=await file.readFile();
   return parse(bytes);
 }finally{if(file)await file.close().catch(()=>{})}
}
async function persistUnlocked(dir,record,{create=false}={}){
 if(!validateMacUpdateTransaction(record))deny("invalid_transaction");
 const full=path.join(dir,NAME);
 if(create){
  // Do not replace an existing journal or symlink at creation time.
  try{await fs.promises.lstat(full);deny("existing_transaction")}
  catch(error){if(error?.code!=="ENOENT")throw error}
 }
 const temp=path.join(dir,"update-transaction-"+crypto.randomBytes(8).toString("hex")+".tmp");
 let out;
 try{
  out=await fs.promises.open(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const payload=seal(record);
  if(Buffer.byteLength(payload)>MAX_BYTES)deny("journal_too_large");
  await out.writeFile(payload,"utf8");
  await out.sync();
  await out.close();
  out=null;
  await fs.promises.rename(temp,full);
  // An atomic rename is not, by itself, durable after a sudden power loss.
  // Flush the containing directory, failing closed if unsupported.
  let dirHandle;
  try{
   dirHandle=await fs.promises.open(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
     fs.constants.O_NOFOLLOW);
   await dirHandle.sync();
  }finally{if(dirHandle)await dirHandle.close().catch(()=>{})}
 }catch(error){
  if(out)await out.close().catch(()=>{});
  await fs.promises.rm(temp,{force:true}).catch(()=>{});
  throw error;
 }
}
async function withLock(dir,operation){
 await safeStageDir(dir);
 let lock;
 try{
   // A stale lock is NOT automatically removed after a crash. Future helper
   // recovery must inspect the durable journal and the actual process state.
   lock=await fs.promises.open(path.join(dir,LOCK),
     fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
     fs.constants.O_NOFOLLOW,0o600);
 }catch(error){
   if(error?.code==="EEXIST")deny("active_or_stale_lock");
   throw error;
 }
 try{return await operation()}
 finally{
   await lock.close().catch(()=>{});
   await fs.promises.rm(path.join(dir,LOCK),{force:true}).catch(()=>{});
 }
}
async function createMacUpdateJournal(dir,initial){
 if(!validateMacUpdateTransaction(initial)||initial.state!=="archive_verified"||
    initial.sequence!==0)deny("not_initial_transaction");
 return withLock(dir,async()=>{
  await persistUnlocked(dir,initial,{create:true});
  return initial;
 });
}
async function advanceMacUpdateJournal(dir,{expectedSequence,nextState,evidence}){
 if(!Number.isSafeInteger(expectedSequence)||expectedSequence<0)deny("invalid_sequence");
 return withLock(dir,async()=>{
  const current=await readUnlocked(dir);
  if(current.sequence!==expectedSequence)deny("concurrent_or_stale_transition");
  const next=transitionMacUpdateTransaction(current,nextState,evidence);
  await persistUnlocked(dir,next);
  return next;
 });
}
async function readMacUpdateJournal(dir){
 await safeStageDir(dir);
 return readUnlocked(dir);
}
module.exports={createMacUpdateJournal,advanceMacUpdateJournal,readMacUpdateJournal};
