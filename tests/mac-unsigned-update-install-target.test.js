"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {inspectUserScopedMacInstall}=require("../macUnsignedUpdateInstallTarget");
const SKIP=process.platform==="win32";
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-target-"));
 fs.chmodSync(root,0o700);
 fs.mkdirSync(path.join(root,"Applications"),{mode:0o700});
 fs.mkdirSync(path.join(root,"Applications","AoE2HDBets Watcher.app"),{mode:0o700});
 fs.mkdirSync(path.join(root,"staged"),{mode:0o700});
 return {root,installed:path.join(root,"Applications","AoE2HDBets Watcher.app"),
   staging:path.join(root,"staged"),
   check:overrides=>inspectUserScopedMacInstall({
    installedPath:path.join(root,"Applications","AoE2HDBets Watcher.app"),
    homeDirectory:root,stagingDirectory:path.join(root,"staged"),...overrides}),
   close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("user-owned Applications candidate requires future runtime verification, never grants authority",{skip:SKIP},async()=>{
 const f=fixture();try{
   const result=await f.check();
   assert.equal(result.status,"candidate");
   assert.equal(result.verifiedInstallAuthority,false);
   assert.equal(Object.isFrozen(result),true);
 }finally{f.close();}
});
test("system /Applications never gains silent unprivileged replacement privileges",{skip:SKIP},async()=>{
 const f=fixture();try{
   const result=await f.check({installedPath:"/Applications/AoE2HDBets Watcher.app"});
   assert.equal(result.status,"migration_required");
   assert.equal(result.verifiedInstallAuthority,false);
 }finally{f.close();}
});
test("path traversal, wrong basename, and symlinked app or staging are refused",{skip:SKIP},async()=>{
 const f=fixture();try{
   assert.equal((await f.check({installedPath:f.root+"/Applications/../Applications/AoE2HDBets Watcher.app"})).status,"blocked");
   assert.equal((await f.check({installedPath:path.join(f.root,"Applications","Different.app")})).status,"blocked");
   fs.renameSync(f.staging,f.staging+"-real");
   fs.symlinkSync(f.staging+"-real",f.staging);
   assert.equal((await f.check()).reason,"symlink_or_not_directory");
 }finally{f.close();}
});
test("unsafe directory permissions or missing install are rejected",{skip:SKIP},async()=>{
 const f=fixture();try{
   fs.chmodSync(path.join(f.root,"Applications"),0o777);
   assert.equal((await f.check()).reason,"unsafe_permissions");
   fs.chmodSync(path.join(f.root,"Applications"),0o700);
   fs.rmSync(f.installed,{recursive:true,force:true});
   assert.equal((await f.check()).reason,"missing_user_install_or_staging");
 }finally{f.close();}
});
test("preflight is read-only and never invokes privilege escalation",()=>{
 const code=fs.readFileSync(path.join(__dirname,"..","macUnsignedUpdateInstallTarget.js"),"utf8");
 assert.doesNotMatch(code,/execFile|spawn|child_process|sudo|xattr|spctl|chmodSync|renameSync/);
 assert.match(code,/verifiedInstallAuthority:false/);
});
