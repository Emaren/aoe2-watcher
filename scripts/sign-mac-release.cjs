"use strict";
// OFFLINE release utility, not part of the installed Watcher. Never store the
// release private key in GitHub, Watcher userData or the web server.
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const MIN_BYTES=1024*1024,MAX_BYTES=512*1024*1024;
function stop(reason){const e=new Error("STOP: offline Mac release: "+reason);
  e.code="AOE2_OFFLINE_SIGNING_REFUSED";throw e;}
function archiveName(version,arch){
  if(typeof version!=="string"||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)||
    !["arm64","x64"].includes(arch))stop("invalid stable version or architecture");
  return "AoE2HDBets Watcher-"+version+"-"+arch+"-mac.zip";
}
async function readNoFollow(file,{ownerOnly=false}={}){
  if(typeof file!=="string"||!path.isAbsolute(file)||
    path.normalize(file)!==file||file.includes("\0")||!fs.constants.O_NOFOLLOW)
    stop("unsafe file path");
  const handle=await fs.promises.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile())stop("non-regular input");
    if(typeof process.getuid==="function"&&stat.uid!==process.getuid())stop("wrong owner");
    if(ownerOnly&&(stat.mode&0o077))stop("private key must be owner-only");
    return {handle,stat};
  }catch(error){await handle.close().catch(()=>{});throw error;}
}
async function hashNativeZip(file,name){
  if(path.basename(file)!==name)stop("incorrect native Mac updater basename");
  const {handle,stat}=await readNoFollow(file);
  try{
    if(stat.size<MIN_BYTES||stat.size>MAX_BYTES)stop("archive size out of range");
    const hash=crypto.createHash("sha256");let size=0;
    for await (const bytes of handle.createReadStream({autoClose:false})){
      size+=bytes.length;
      if(size>stat.size||size>MAX_BYTES)stop("archive mutated or oversized");
      hash.update(bytes);
    }
    const after=await handle.stat();
    if(size!==stat.size||after.size!==stat.size||
      after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)
      stop("archive changed during signing");
    return {bytes:size,sha256:hash.digest("hex")};
  }finally{await handle.close().catch(()=>{});}
}
function resolveApprovedKey(privateKeyPem,approvedPublicSpkiSha256){
  if(typeof privateKeyPem!=="string"||privateKeyPem.length>16000||
    typeof approvedPublicSpkiSha256!=="string"||
    !/^[0-9a-f]{64}$/.test(approvedPublicSpkiSha256))
    stop("missing key or independently approved public fingerprint");
  let key;
  try{key=crypto.createPrivateKey(privateKeyPem);}catch{stop("invalid signing key");}
  if(key.asymmetricKeyType!=="ed25519")stop("must use Ed25519");
  const publicDer=crypto.createPublicKey(key).export({format:"der",type:"spki"});
  const actual=crypto.createHash("sha256").update(publicDer).digest();
  if(!crypto.timingSafeEqual(actual,Buffer.from(approvedPublicSpkiSha256,"hex")))
    stop("signing key does not match approved fingerprint");
  return key;
}
async function signMacRelease({archivePath,version,arch="arm64",sourceSha,
  privateKeyPem,approvedPublicSpkiSha256}){
  if(typeof sourceSha!=="string"||!/^[0-9a-f]{40}$/.test(sourceSha))
    stop("exact certified 40-character source required");
  const name=archiveName(version,arch);
  const artifact=await hashNativeZip(archivePath,name);
  const key=resolveApprovedKey(privateKeyPem,approvedPublicSpkiSha256);
  const manifest={schema:1,channel:"stable",platform:"darwin",arch,version,sourceSha,
    artifact:{name,bytes:artifact.bytes,sha256:artifact.sha256,
      url:"https://aoe2war.com/downloads/"+encodeURIComponent(name)}};
  const payload=Buffer.from(JSON.stringify(manifest),"utf8");
  const sig=crypto.sign(null,payload,key);
  if(sig.length!==64)stop("bad Ed25519 signature length");
  const envelope=Buffer.from(JSON.stringify({
    payload:payload.toString("base64"),signature:sig.toString("base64")})+"\n","utf8");
  if(envelope.length>16384)stop("envelope too large");
  return {manifest,envelope};
}
async function signToPrivateOutput({archivePath,version,arch="arm64",
  sourceSha,keyPath,approvedPublicSpkiSha256,outputPath}){
  if(typeof outputPath!=="string"||!path.isAbsolute(outputPath)||
    path.normalize(outputPath)!==outputPath||outputPath.includes("\0")||
    !fs.constants.O_NOFOLLOW)stop("bad output path");
  if(path.basename(outputPath)!=="watcher-mac-release-"+version+"-"+arch+".json")
    stop("unexpected envelope filename");
  const parent=await fs.promises.lstat(path.dirname(outputPath));
  if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)||
    (typeof process.getuid==="function"&&parent.uid!==process.getuid()))
    stop("output directory must be privately owned");
  const {handle,stat}=await readNoFollow(keyPath,{ownerOnly:true});
  let privateKeyPem;
  try{
    if(stat.size<1||stat.size>16000)stop("key file too large");
    privateKeyPem=await handle.readFile("utf8");
  }finally{await handle.close().catch(()=>{});}
  const result=await signMacRelease({
    archivePath,version,arch,sourceSha,privateKeyPem,approvedPublicSpkiSha256});
  let fd;
  try{
    fd=await fs.promises.open(outputPath,fs.constants.O_WRONLY|
      fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    await fd.writeFile(result.envelope);
    await fd.sync();
    await fd.close();fd=null;
    let dirfd;
    try{
      dirfd=await fs.promises.open(path.dirname(outputPath),
        fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
      await dirfd.sync();
    }finally{if(dirfd)await dirfd.close().catch(()=>{});}
    return {outputPath,manifestSha256:crypto.createHash("sha256")
      .update(result.envelope).digest("hex"),
      artifactSha256:result.manifest.artifact.sha256};
  }finally{if(fd)await fd.close().catch(()=>{});}
}
async function main(args){
  if(args.length!==7)stop("expected absolute native ZIP, version, arch, exact source SHA, private key file, approved SPKI SHA256, private output file");
  const [archivePath,version,arch,sourceSha,keyPath,approvedPublicSpkiSha256,outputPath]=args;
  const r=await signToPrivateOutput({archivePath,version,arch,sourceSha,
    keyPath,approvedPublicSpkiSha256,outputPath});
  process.stdout.write("SIGNED "+path.basename(r.outputPath)+
    " envelope_sha256="+r.manifestSha256+" artifact_sha256="+r.artifactSha256+"\n");
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{
  console.error(e.message);process.exitCode=1;
});
module.exports={archiveName,hashNativeZip,signMacRelease,signToPrivateOutput};
