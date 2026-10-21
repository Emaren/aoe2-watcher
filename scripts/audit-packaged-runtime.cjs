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

const FORBIDDEN_BUILD_MODULES=["sprintf-js","roarr","global-agent","electron-builder","@electron/asar"];
const UNQUALIFIED_MAC_MODULES=[
 "macUnsignedUpdateManifest.js","macUnsignedUpdateStaging.js",
 "macUnsignedUpdateBundleAudit.js","macUnsignedUpdateTransaction.js",
 "macUnsignedUpdateJournal.js","macUnsignedUpdateInstallTarget.js",
 "macUnsignedUpdateSwapRehearsal.js",
];
// A successful ASAR build is not proof Electron can load its own main
// process. Electron-builder's explicit files allowlist must contain every
// static local CommonJS import from the app's shipped root JavaScript.
function inspectRootModuleClosure(archivePath, files) {
 const set=new Set(files);
 const rootScripts=files.filter(item=>!item.includes("/") && item.endsWith(".js"));
 const inspected=[];
 for(const rootFile of rootScripts) {
  const bytes=asar.extractFile(archivePath,rootFile);
  if(bytes.length>4*1024*1024)reject("unbounded root module: "+rootFile);
  const source=bytes.toString("utf8");
  const references=[];
  const matches=source.matchAll(/\\brequire\\s*\\(\\s*["'](\\.[^"']+)["']\\s*\\)/g);
  for(const match of matches) {
   const spec=match[1];
   const joined=path.posix.normalize(path.posix.join(path.posix.dirname(rootFile),spec));
   if(joined.startsWith("../")||joined===".."||joined.startsWith("/"))
    reject("root module import escapes archive: "+rootFile+" -> "+spec);
   const candidates=[joined,joined+".js",joined+".json",joined+"/index.js"];
   if(!candidates.some(item=>set.has(item)))
    reject("missing packaged local CommonJS module: "+rootFile+" -> "+spec);
   references.push(spec);
  }
  inspected.push({file:rootFile,staticLocalImports:references.length});
 }
 return inspected;
}

function devOnlyDependency(pathName) {
 return FORBIDDEN_BUILD_MODULES.some(name=>{
  const prefix="node_modules/"+name;
  return pathName===prefix||pathName.startsWith(prefix+"/")||
    pathName.includes("/"+prefix+"/");
 });
}
function unqualifiedMacHelper(pathName) {
 return UNQUALIFIED_MAC_MODULES.some(name=>pathName===name||pathName.endsWith("/"+name));
}
async function inspectUnpackedSidecar(filePath) {
 const root=filePath+".unpacked";
 let stat;
 try {stat=await fs.promises.lstat(root);}
 catch(error) {
  if(error?.code==="ENOENT")return {fileCount:0,bytes:0,sha256:null,followRedirectsVersions:[]};
  throw error;
 }
 if(!stat.isDirectory()||stat.isSymbolicLink())reject("unpacked sidecar not a real directory");
 const pending=[root],files=[];
 let totalBytes=0;
 while(pending.length){
  const dir=pending.pop();
  const members=await fs.promises.readdir(dir,{withFileTypes:true});
  for(const member of members){
   const full=path.join(dir,member.name);
   const rel=path.relative(root,full).split(path.sep).join("/");
   if(!rel||rel.startsWith("../")||rel.includes("\0"))reject("unpacked escape");
   if(devOnlyDependency(rel))reject("dev-only dependency in unpacked sidecar: "+rel);
   if(unqualifiedMacHelper(rel))reject("unqualified Mac helper in unpacked sidecar: "+rel);
   if(member.isSymbolicLink())reject("unpacked sidecar symlink: "+rel);
   if(member.isDirectory()){
    pending.push(full);
   }else if(member.isFile()){
    const item=await fs.promises.lstat(full);
    if(!item.isFile()||item.isSymbolicLink())reject("changed unpacked sidecar entry: "+rel);
    totalBytes+=item.size;
    if(totalBytes>1200*1024*1024)reject("unpacked sidecar exceeds resource cap");
    files.push({full,rel,size:item.size});
    if(files.length>25000)reject("unpacked sidecar file count exceeded");
   }else reject("unpacked sidecar special file: "+rel);
  }
 }
 files.sort((a,b)=>a.rel<b.rel?-1:a.rel>b.rel?1:0);
 const digest=crypto.createHash("sha256"),versions=[];
 for(const item of files){
  digest.update(item.rel+"\0");
  if(/(^|\/)node_modules\/follow-redirects\/package\.json$/.test(item.rel)){
   if(item.size>128*1024)reject("unbounded unpacked dependency manifest");
   const pkg=JSON.parse(await fs.promises.readFile(item.full,"utf8"));
   if(pkg.name!=="follow-redirects"||pkg.version!=="1.16.1")
    reject("unpatched unpacked redirect transport: "+String(pkg.version));
   versions.push(pkg.version);
  }
  const stream=fs.createReadStream(item.full,{highWaterMark:1024*1024});
  for await(const chunk of stream)digest.update(chunk);
 }
 return {fileCount:files.length,bytes:totalBytes,
  sha256:digest.digest("hex"),followRedirectsVersions:versions};
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
 const rootModuleClosure=inspectRootModuleClosure(filePath,files);
 const appPackage=JSON.parse(asar.extractFile(filePath,"package.json").toString("utf8"));
 if(appPackage.version!=="1.6.5"||appPackage.name!=="aoe2-watcher")reject("candidate identity or version mismatch");
 for(const item of files){
  if(devOnlyDependency(item))reject("dev-only vulnerable/packaging dependency bundled: "+item);
  if(unqualifiedMacHelper(item))reject("unqualified Mac helper accidentally shipped: "+item);
 }
 const installed=files.filter(file=>/(^|\/)node_modules\/follow-redirects\/package\.json$/.test(file));
 if(!installed.length)reject("required redirected HTTP transport manifest absent");
 for(const packageFile of installed){
  // ASAR v3 resolves nested entries using platform-native separators.
  const nativeEntry=packageFile.split("/").join(path.sep);
  const pkg=JSON.parse(asar.extractFile(filePath,nativeEntry).toString("utf8"));
  if(pkg.name!=="follow-redirects" || pkg.version!=="1.16.1")
   reject("runtime redirect dependency not patched: "+pkg.version);
 }
 const sidecar=await inspectUnpackedSidecar(filePath);
 const digest=crypto.createHash("sha256");
 for await(const chunk of fs.createReadStream(filePath,{highWaterMark:1024*1024}))digest.update(chunk);
 return {
  schema:1,kind:"source-only-packaged-runtime-audit",
  archiveSha256:digest.digest("hex"),
  archiveBytes:st.size,entryCount:files.length,
  packageVersion:appPackage.version,
  rootModuleClosure,
  followRedirectsVersions:[...installed.map(x=>"1.16.1"),...sidecar.followRedirectsVersions],
  unpackedSidecar:{fileCount:sidecar.fileCount,bytes:sidecar.bytes,sha256:sidecar.sha256},
  excludedUnqualifiedMacUpdater:true,
  excludedVulnerableDevToolchain:true,
  certifiedInstalledApp:false,
 };
}
audit(process.argv[2]).then(proof=>process.stdout.write(JSON.stringify(proof)+"\n"))
 .catch(e=>{console.error(e.message);process.exitCode=1});
