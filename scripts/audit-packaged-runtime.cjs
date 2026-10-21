"use strict";

// Release-test inspector only. Inspects an already built Electron ASAR and
// never modifies the archive, installs an app or touches a player profile.
// Independent runtime supply-chain proof: dev-only advisory paths must not
// appear in distributed app.asar, while locked runtime HTTP libraries must.
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const asar=require("@electron/asar");

function reject(message){throw new Error("Watcher ASAR runtime qualification refused: "+message);}
function present(files,name){
 return files.some(file=>file===name || file.startsWith(name+"/"));
}
async function audit(filePath) {
 if(typeof filePath!=="string"||!path.isAbsolute(filePath) ||
    path.basename(filePath)!=="app.asar"||filePath.includes("\0"))reject("invalid archive path");
 const st=fs.statSync(filePath);
 if(!st.isFile()||st.size<1024*1024)reject("archive missing or implausibly small");
 // ASAR lists backslash-rooted paths on Windows; normalize before comparing.
 const files=asar.listPackage(filePath).map(x=>x.replace(/\\/g,"/").replace(/^\/+/,""));
 const set=new Set(files);
 if(set.size!==files.length)reject("duplicate archive paths");
 for(const name of ["main.js","watcher.js","telemetryQueue.js","telemetryDelivery.js","package.json"]){
  if(!set.has(name))reject("missing shipped runtime: "+name);
 }
 const appPackage=JSON.parse(asar.extractFile(filePath,"package.json").toString("utf8"));
 if(appPackage.version!=="1.6.5"||appPackage.name!=="aoe2-watcher")reject("candidate identity or version mismatch");
 for(const name of [
  "sprintf-js","roarr","global-agent","electron-builder","@electron/asar",
 ]) {
  if(files.some(file=>file.split("/node_modules/").some(
   (part,index)=>index>0 && (part===name || part.startsWith(name+"/"))
  )) || present(files,"node_modules/"+name))reject("dev-only vulnerable/packaging dependency bundled: "+name);
 }
 for(const name of [
  "macUnsignedUpdateManifest.js","macUnsignedUpdateStaging.js",
  "macUnsignedUpdateBundleAudit.js","macUnsignedUpdateTransaction.js",
  "macUnsignedUpdateJournal.js","macUnsignedUpdateInstallTarget.js",
  "macUnsignedUpdateSwapRehearsal.js",
 ]) if(set.has(name))reject("unqualified Mac helper accidentally shipped: "+name);
 const installed=files.filter(file=>/(^|\/)node_modules\/follow-redirects\/package\.json$/.test(file));
 if(!installed.length)reject("required redirected HTTP transport manifest absent");
 for(const packageFile of installed){
  // ASAR v3 resolves nested entries using platform-native separators.
  const nativeEntry=packageFile.split("/").join(path.sep);
  const pkg=JSON.parse(asar.extractFile(filePath,nativeEntry).toString("utf8"));
  if(pkg.name!=="follow-redirects" || pkg.version!=="1.16.1")
   reject("runtime redirect dependency not patched: "+pkg.version);
 }
 const digest=crypto.createHash("sha256");
 for await(const chunk of fs.createReadStream(filePath,{highWaterMark:1024*1024}))digest.update(chunk);
 return {
  schema:1,kind:"source-only-packaged-runtime-audit",
  archiveSha256:digest.digest("hex"),
  archiveBytes:st.size,entryCount:files.length,
  packageVersion:appPackage.version,
  followRedirectsVersions:installed.map(x=>"1.16.1"),
  excludedUnqualifiedMacUpdater:true,
  excludedVulnerableDevToolchain:true,
  certifiedInstalledApp:false,
 };
}
audit(process.argv[2]).then(proof=>process.stdout.write(JSON.stringify(proof)+"\n"))
 .catch(e=>{console.error(e.message);process.exitCode=1});
