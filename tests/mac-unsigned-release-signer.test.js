"use strict";
const assert=require("node:assert/strict"),test=require("node:test");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {signMacRelease,signToPrivateOutput}=require("../scripts/sign-mac-release.cjs");
const {verifySignedMacReleaseEnvelope,verifyDownloadedArtifactBytes}=
  require("../macUnsignedUpdateManifest");
const keys=crypto.generateKeyPairSync("ed25519");
const privatePem=keys.privateKey.export({format:"pem",type:"pkcs8"});
const publicPem=keys.publicKey.export({format:"pem",type:"spki"});
const approved=crypto.createHash("sha256")
  .update(keys.publicKey.export({format:"der",type:"spki"})).digest("hex");
const sourceSha="c".repeat(40);
const archive=Buffer.alloc(1048576,0x47);
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-mac-signer-"));
  fs.chmodSync(dir,0o700);
  const archivePath=path.join(dir,"AoE2HDBets Watcher-1.6.6-arm64-mac.zip");
  fs.writeFileSync(archivePath,archive,{mode:0o600});
  return {dir,archivePath,keyPath:path.join(dir,"key.pem"),
    outputPath:path.join(dir,"watcher-mac-release-1.6.6-arm64.json")};
}
test("offline signed publisher output is accepted by the independently implemented client verifier",async()=>{
  const f=fixture();
  try{
    const {manifest,envelope}=await signMacRelease({archivePath:f.archivePath,
      version:"1.6.6",sourceSha,privateKeyPem,approvedPublicSpkiSha256:approved});
    assert.equal(manifest.artifact.name,path.basename(f.archivePath));
    assert.equal(manifest.sourceSha,sourceSha);
    const verified=verifySignedMacReleaseEnvelope({envelopeBytes:envelope,
      currentVersion:"1.6.5",targetArch:"arm64",pinnedPublicKeyPem:publicPem});
    assert.equal(verified.verified,true,verified.reason);
    assert.equal(verifyDownloadedArtifactBytes(verified,archive),true);
    const corrupt=Buffer.from(archive);corrupt[0]^=1;
    assert.equal(verifyDownloadedArtifactBytes(verified,corrupt),false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test("source, version, filename, approved fingerprint and key algorithm fail closed",async()=>{
  const f=fixture();
  try{
    const input={archivePath:f.archivePath,version:"1.6.6",sourceSha,
      privateKeyPem,approvedPublicSpkiSha256:approved};
    await assert.rejects(signMacRelease({...input,version:"1.6.7"}),/incorrect native/);
    await assert.rejects(signMacRelease({...input,sourceSha:"not-a-SHA"}),/certified 40-character/);
    await assert.rejects(signMacRelease({...input,version:"1.6.6-beta"}),/invalid stable/);
    await assert.rejects(signMacRelease({...input,approvedPublicSpkiSha256:"0".repeat(64)}),/does not match/);
    const rsa=crypto.generateKeyPairSync("rsa",{modulusLength:2048}).privateKey
      .export({format:"pem",type:"pkcs8"});
    await assert.rejects(signMacRelease({...input,privateKeyPem:rsa}),/must use Ed25519/);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test("offline signer forbids world-readable private keys and cannot overwrite an existing receipt",{
  skip:process.platform==="win32"||!fs.constants.O_NOFOLLOW},async()=>{
  const f=fixture();
  try{
    fs.writeFileSync(f.keyPath,privatePem,{mode:0o600});
    const args={archivePath:f.archivePath,version:"1.6.6",arch:"arm64",
      sourceSha,keyPath:f.keyPath,approvedPublicSpkiSha256:approved,outputPath:f.outputPath};
    const out=await signToPrivateOutput(args);
    assert.equal(fs.statSync(f.outputPath).mode&0o077,0);
    assert.equal(out.artifactSha256,crypto.createHash("sha256").update(archive).digest("hex"));
    const bytes=fs.readFileSync(f.outputPath);
    await assert.rejects(signToPrivateOutput(args),{code:"EEXIST"});
    assert.deepEqual(fs.readFileSync(f.outputPath),bytes);
    fs.unlinkSync(f.outputPath);
    fs.chmodSync(f.keyPath,0o644);
    await assert.rejects(signToPrivateOutput(args),/owner-only/);
    fs.chmodSync(f.keyPath,0o600);
    const original=f.keyPath+".original";
    fs.renameSync(f.keyPath,original);
    fs.symlinkSync(original,f.keyPath);
    await assert.rejects(signToPrivateOutput(args),e=>e.code==="ELOOP"||
      String(e.message).includes("unsafe file path"));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test("CLI prints only release digests and never signing key material",{
  skip:process.platform==="win32"||!fs.constants.O_NOFOLLOW},()=>{
  const f=fixture();
  try{
    fs.writeFileSync(f.keyPath,privatePem,{mode:0o600});
    const cli=path.join(__dirname,"..","scripts","sign-mac-release.cjs");
    const proc=spawnSync(process.execPath,[cli,f.archivePath,"1.6.6","arm64",
      sourceSha,f.keyPath,approved,f.outputPath],{encoding:"utf8",timeout:30000});
    assert.equal(proc.status,0,proc.stderr);
    assert.match(proc.stdout,/^SIGNED watcher-mac-release-1\.6\.6-arm64\.json/);
    assert.doesNotMatch(proc.stdout+proc.stderr,/BEGIN PRIVATE KEY/);
    const verified=verifySignedMacReleaseEnvelope({
      envelopeBytes:fs.readFileSync(f.outputPath),
      currentVersion:"1.6.5",pinnedPublicKeyPem:publicPem});
    assert.equal(verified.verified,true);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
