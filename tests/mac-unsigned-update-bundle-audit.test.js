"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {inspectExtractedMacBundle}=require("../macUnsignedUpdateBundleAudit");
const skip=process.platform==="win32";
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-bundle-audit-"));
 const appRoot=path.join(dir,"AoE2HDBets Watcher.app");
 fs.mkdirSync(path.join(appRoot,"Contents","MacOS"),{recursive:true});
 fs.mkdirSync(path.join(appRoot,"Contents","Frameworks"),{recursive:true});
 fs.writeFileSync(path.join(appRoot,"Contents","Info.plist"),"fixture-only");
 const executable=path.join(appRoot,"Contents","MacOS","AoE2HDBets Watcher");
 fs.writeFileSync(executable,"fixture executable");
 fs.chmodSync(executable,0o755);
 const keys={CFBundleIdentifier:"com.aoe2hdbets.watcher",
   CFBundleShortVersionString:"1.6.6",CFBundleExecutable:"AoE2HDBets Watcher"};
 const options={appRoot,version:"1.6.6",arch:"arm64",
   getPlistKey:async(_path,key)=>keys[key],
   getExecutableArchitectures:async()=>["arm64"]};
 return {dir,appRoot,keys,options};
}
test("pure extracted-bundle audit accepts exact ID, version, architecture and enclosed framework symlink",{skip},async()=>{
 const f=fixture();
 try{
  const target=path.join(f.appRoot,"Contents","Frameworks","lib.dylib");
  fs.writeFileSync(target,"dylib fixture");
  fs.symlinkSync("lib.dylib",path.join(f.appRoot,"Contents","Frameworks","Current"));
  const result=await inspectExtractedMacBundle(f.options);
  assert.equal(result.valid,true);
  assert.equal(result.bundleId,"com.aoe2hdbets.watcher");
  assert.equal(result.version,"1.6.6");
  assert.equal(result.arch,"arm64");
  assert.ok(result.fileCount>=4);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("bundle identity, version, wrong arch, or nonexecutable main binary stops preflight",{skip},async()=>{
 const f=fixture();
 try{
  f.keys.CFBundleIdentifier="com.attacker.other";
  await assert.rejects(inspectExtractedMacBundle(f.options),/bundle_identifier_mismatch/);
  f.keys.CFBundleIdentifier="com.aoe2hdbets.watcher";
  f.keys.CFBundleShortVersionString="1.6.5";
  await assert.rejects(inspectExtractedMacBundle(f.options),/bundle_version_mismatch/);
  f.keys.CFBundleShortVersionString="1.6.6";
  await assert.rejects(inspectExtractedMacBundle({...f.options,
    getExecutableArchitectures:async()=>["x64"]}),/executable_architecture_mismatch/);
  fs.chmodSync(path.join(f.appRoot,"Contents","MacOS","AoE2HDBets Watcher"),0o644);
  await assert.rejects(inspectExtractedMacBundle(f.options),/missing_or_nonexecutable_main_binary/);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("absolute, escaping and dangling bundle symlinks fail closed",{skip},async()=>{
 const f=fixture();
 try{
  const link=path.join(f.appRoot,"Contents","Frameworks","Current");
  for(const target of ["/etc/passwd","../../../../outside","nonexistent"]){
   fs.symlinkSync(target,link);
   await assert.rejects(inspectExtractedMacBundle(f.options),/bundle_symlink|symlink_escape/);
   fs.unlinkSync(link);
  }
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("no alternate app name or root symlink is admitted",{skip},async()=>{
 const f=fixture();
 try{
  await assert.rejects(inspectExtractedMacBundle({...f.options,
    appRoot:path.join(f.dir,"Different.app")}),/unexpected_app_path/);
  const link=path.join(f.dir,"other","AoE2HDBets Watcher.app");
  fs.mkdirSync(path.dirname(link));
  fs.symlinkSync(f.appRoot,link);
  await assert.rejects(inspectExtractedMacBundle({...f.options,appRoot:link}),
    /bundle_root_not_real/);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("read-only audit cannot extract, install, quit, elevate or clear quarantine",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","macUnsignedUpdateBundleAudit.js"),"utf8");
 const implementation=source.replace(/^\s*\/\/.*$/gm,"");
 assert.doesNotMatch(implementation,/exec\(|spawn\(|quitAndInstall|rename\(|rmSync\(|xattr|unzip/);
 assert.match(source,/plutil/);
 assert.match(source,/lipo/);
});
