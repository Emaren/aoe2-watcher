"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
 createMacUpdateTransaction,transitionMacUpdateTransaction,
 validateMacUpdateTransaction,classifyMacUpdateRecovery,
}=require("../macUnsignedUpdateTransaction");
function start(){
 return createMacUpdateTransaction({
  transactionId:"a".repeat(32),version:"1.6.6",
  artifactSha256:"b".repeat(64),sourceSha:"c".repeat(40),
 });
}
function advance(record,...states){
 let next=record;
 for(const state of states)next=transitionMacUpdateTransaction(next,state,"receipt_"+state);
 return next;
}
test("unsigned Mac update starts at archive_verified, not installed",()=>{
 const initial=start();
 assert.equal(validateMacUpdateTransaction(initial),true);
 assert.equal(initial.state,"archive_verified");
 assert.equal(initial.sequence,0);
 assert.equal(classifyMacUpdateRecovery(initial),"DO_NOT_SWAP_OLD_APP_MAY_STILL_RUN");
 assert.ok(Object.isFrozen(initial));
 assert.ok(Object.isFrozen(initial.transitions));
});
test("full audited transition chain needs health confirmation before commit",()=>{
 const states=[
  "bundle_verified","idle_confirmed","quit_requested","process_exited",
  "old_app_backed_up","new_app_swapped","relaunch_requested",
  "health_confirmed","committed",
 ];
 let current=start();
 for (const state of states)current=advance(current,state);
 assert.equal(current.state,"committed");
 assert.equal(current.sequence,states.length);
 assert.equal(classifyMacUpdateRecovery(current),"NO_ACTION_CONFIRMED");
 assert.equal(validateMacUpdateTransaction(JSON.parse(JSON.stringify(current))),true);
});
test("no skip from downloaded to swapped, or quit request to process exit proof bypass",()=>{
 const initial=start();
 for (const next of ["committed","new_app_swapped","process_exited","health_confirmed","idle_confirmed"]) {
   assert.throws(()=>advance(initial,next),/illegal_transition/);
 }
 const idle=advance(initial,"bundle_verified","idle_confirmed","quit_requested");
 assert.throws(()=>advance(idle,"old_app_backed_up"),/illegal_transition/);
 const relaunched=advance(idle,"process_exited","old_app_backed_up",
   "new_app_swapped","relaunch_requested");
 assert.throws(()=>advance(relaunched,"committed"),/illegal_transition/);
});
test("post-backup interruption always requires independent restore/health assessment",()=>{
 const base=advance(start(),"bundle_verified","idle_confirmed","quit_requested","process_exited");
 for(const states of [
  ["old_app_backed_up"],
  ["old_app_backed_up","new_app_swapped"],
  ["old_app_backed_up","new_app_swapped","relaunch_requested"],
  ["old_app_backed_up","new_app_swapped","relaunch_requested","health_confirmed"],
 ]){
   const record=advance(base,...states);
   assert.equal(classifyMacUpdateRecovery(record),"MANUAL_VERIFY_BACKUP_AND_RESTORE");
 }
 const failBefore=advance(base,"failed_before_backup");
 assert.equal(classifyMacUpdateRecovery(failBefore),"NO_ACTION_OLD_APP_UNTOUCHED");
});
test("rollback is explicit, never looks like healthy installed version",()=>{
 const swapped=advance(start(),"bundle_verified","idle_confirmed","quit_requested",
 "process_exited","old_app_backed_up","new_app_swapped");
 const rollback=advance(swapped,"rollback_requested","rolled_back");
 assert.equal(classifyMacUpdateRecovery(rollback),"NO_ACTION_ROLLED_BACK");
 assert.throws(()=>advance(rollback,"committed"),/illegal_transition/);
});
test("tampered/malformed journal can't authorize any recovery action",()=>{
 const original=advance(start(),"bundle_verified","idle_confirmed");
 for(const wrong of [
   {...original,state:"committed"},
   {...original,sequence:2,transitions:[]},
   {...original,artifactSha256:"invalid"},
   {...original,version:"1.6.6-beta"},
   {...original,transitions:[...original.transitions,{sequence:3,from:"idle_confirmed",to:"committed",evidence:"fake"}]},
   {...original,otherProperty:"unexpected"},
 ]){
  assert.equal(validateMacUpdateTransaction(wrong),false);
  assert.equal(classifyMacUpdateRecovery(wrong),"REFUSE_INVALID_JOURNAL");
  assert.throws(()=>advance(wrong,"quit_requested"),/invalid_prior_transaction/);
 }
});
test("no filesystem, userData or process operations exist in disconnected updater plan",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","macUnsignedUpdateTransaction.js"),"utf8");
 assert.doesNotMatch(source,/require\(["'](?:node:)?(?:fs|child_process|electron|https)["']\)/);
 assert.doesNotMatch(source,/quitAndInstall\(|process\.exit\(|spawn\(|rmSync\(|renameSync\(/);
});
