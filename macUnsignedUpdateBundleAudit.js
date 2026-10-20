"use strict";

// Read-only structural preflight for a previously authenticated and safely
// extracted macOS app bundle. This does NOT unzip, install, chmod, launch,
// move, sign, notarize, clear quarantine, or trust the ZIP's contents.
// The caller must separately prove archive authenticity and safe extraction.
const fs=require("node:fs");
const path=require("node:path");
const {execFile}=require("node:child_process");
const {promisify}=require("node:util");
const run=promisify(execFile);
const EXPECTED_NAME="AoE2HDBets Watcher.app";
const EXPECTED_ID="com.aoe2hdbets.watcher";
const MAX_ITEMS=25000;
const MAX_DEPTH=32;
const MAX_EXPANDED_BYTES=1200*1024*1024;

function refused(reason){
 const error=new Error("Mac bundle inspection refused: "+reason);
 error.code="AOE2_MAC_BUNDLE_REJECTED";
 throw error;
}
function inside(root,candidate){
 return candidate===root||candidate.startsWith(root+path.sep);
}
async function readPlistKey(plist,key){
 const {stdout}=await run("/usr/bin/plutil",
  ["-extract",key,"raw","-o","-",plist],
  {encoding:"utf8",timeout:5000,maxBuffer:4096});
 return stdout.trim();
}
async function readExecutableArchitectures(executable){
 const {stdout}=await run("/usr/bin/lipo",["-archs",executable],
   {encoding:"utf8",timeout:5000,maxBuffer:4096});
 return stdout.trim().split(/\s+/);
}
async function inspectExtractedMacBundle({
  appRoot,version,arch="arm64",
  getPlistKey=readPlistKey,
  getExecutableArchitectures=readExecutableArchitectures,
}={}){
 if(typeof appRoot!=="string"||!path.isAbsolute(appRoot)||
    appRoot.includes("\0")||path.normalize(appRoot)!==appRoot||
    path.basename(appRoot)!==EXPECTED_NAME)refused("unexpected_app_path");
 if(typeof version!=="string"||!/^\d+\.\d+\.\d+$/.test(version)||
    !["arm64","x64"].includes(arch))refused("invalid_release_version_or_arch");
 const rootStat=await fs.promises.lstat(appRoot);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())refused("bundle_root_not_real");
 // macOS normally resolves /var to /private/var. A final-component
 // symlink is forbidden, but a preexisting OS-owned ancestor alias is not.
 const root=appRoot;
 const realRoot=await fs.promises.realpath(appRoot);

 let itemCount=0,expandedBytes=0;
 const pending=[{dir:appRoot,depth:0}];
 while(pending.length){
  const {dir,depth}=pending.pop();
  if(depth>MAX_DEPTH)refused("bundle_nesting_limit");
  const members=await fs.promises.readdir(dir);
  for(const name of members){
   const full=path.join(dir,name);
   if(!inside(root,full))refused("bundle_path_escape");
   itemCount++;
   if(itemCount>MAX_ITEMS)refused("bundle_file_count_limit");
   const stat=await fs.promises.lstat(full);
   if(stat.isSymbolicLink()){
    const target=await fs.promises.readlink(full);
    if(path.isAbsolute(target))refused("absolute_bundle_symlink");
    const lexical=path.resolve(path.dirname(full),target);
    if(!inside(root,lexical))refused("relative_bundle_symlink_escape");
    let resolved;
    try{resolved=await fs.promises.realpath(full)}
    catch{refused("dangling_or_cyclic_bundle_symlink")}
    if(!inside(realRoot,resolved))refused("resolved_bundle_symlink_escape");
    continue;
   }
   if(stat.isDirectory()){
    pending.push({dir:full,depth:depth+1});
   } else if(stat.isFile()){
    expandedBytes+=stat.size;
    if(expandedBytes>MAX_EXPANDED_BYTES)refused("expanded_bundle_size_limit");
   } else refused("unexpected_bundle_file_type");
  }
 }
 const plist=path.join(appRoot,"Contents","Info.plist");
 const id=await getPlistKey(plist,"CFBundleIdentifier");
 const actualVersion=await getPlistKey(plist,"CFBundleShortVersionString");
 const executableName=await getPlistKey(plist,"CFBundleExecutable");
 if(id!==EXPECTED_ID)refused("bundle_identifier_mismatch");
 if(actualVersion!==version)refused("bundle_version_mismatch");
 if(typeof executableName!=="string"||
    !/^[a-zA-Z0-9][a-zA-Z0-9 ._+\-]{0,100}$/.test(executableName)||
    executableName==="."||executableName==="..")refused("invalid_executable_name");
 const executable=path.join(appRoot,"Contents","MacOS",executableName);
 const exeStat=await fs.promises.lstat(executable);
 if(!exeStat.isFile()||exeStat.isSymbolicLink()||(exeStat.mode&0o111)===0) {
  refused("missing_or_nonexecutable_main_binary");
 }
 const supported=await getExecutableArchitectures(executable);
 if(!Array.isArray(supported)||!supported.includes(arch)) {
  refused("executable_architecture_mismatch");
 }
 return Object.freeze({
  valid:true,appRoot,bundleId:id,version:actualVersion,arch,
  fileCount:itemCount,expandedBytes,
 });
}
module.exports={inspectExtractedMacBundle};
