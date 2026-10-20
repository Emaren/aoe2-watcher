"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {verifySignedMacReleaseEnvelope,verifyDownloadedArtifactBytes,verifyDownloadedArtifactFile} =
  require("../macUnsignedUpdateManifest");

const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const pem=publicKey.export({type:"spki",format:"pem"});
const artifact=Buffer.alloc(1024*1024,97);
const digest=crypto.createHash("sha256").update(artifact).digest("hex");
const sha="ab".repeat(20);
function valid() {
 return {schema:1,channel:"stable",platform:"darwin",arch:"arm64",version:"1.6.6",
   sourceSha:sha,artifact:{
     name:"AoE2HDBets Watcher-1.6.6-arm64.zip",
     bytes:artifact.length,sha256:digest,
     url:"https://aoe2war.com/downloads/AoE2HDBets%20Watcher-1.6.6-arm64.zip"}};
}
function sign(input=valid(),key=privateKey) {
 const payload=Buffer.from(JSON.stringify(input),"utf8");
 return Buffer.from(JSON.stringify({
   payload:payload.toString("base64"),
   signature:crypto.sign(null,payload,key).toString("base64"),
 }),"utf8");
}
function verify(bytes,currentVersion="1.6.5",key=pem) {
 return verifySignedMacReleaseEnvelope({
   envelopeBytes:bytes,currentVersion,targetArch:"arm64",pinnedPublicKeyPem:key,
 });
}

test("offline-signed stable archive proof binds exact version, source, origin, architecture and checksum",()=>{
 const result=verify(sign());
 assert.equal(result.verified,true);
 assert.equal(result.manifest.version,"1.6.6");
 assert.equal(verifyDownloadedArtifactBytes(result,artifact),true);
 const corrupted=Buffer.from(artifact);corrupted[0]^=1;
 assert.equal(verifyDownloadedArtifactBytes(result,corrupted),false);
 assert.equal(verifyDownloadedArtifactBytes(result,artifact.subarray(1)),false);
 assert.equal(verifyDownloadedArtifactBytes({verified:false},artifact),false);
});

test("no pinned release key, incorrect release key or tampering cannot grant update",()=>{
 const signed=sign();
 const another=crypto.generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"});
 assert.equal(verify(signed,"1.6.5",undefined).verified,true); // helper defaults to fixture key
 assert.equal(verifySignedMacReleaseEnvelope({envelopeBytes:signed,currentVersion:"1.6.5"}).verified,false);
 assert.equal(verify(signed,"1.6.5",another).reason,"signature_invalid");
 const envelope=JSON.parse(signed.toString("utf8"));
 envelope.payload=Buffer.from(JSON.stringify({...valid(),version:"1.6.7"})).toString("base64");
 assert.equal(verify(Buffer.from(JSON.stringify(envelope))).reason,"signature_invalid");
});

test("stable version, strict origin, exact asset and platform checks refuse unsafe metadata",()=>{
 const cases=[
  [{...valid(),version:"1.6.5"},"non_newer_version"],
  [{...valid(),version:"1.6.6-beta.1"},"non_newer_version"],
  [{...valid(),sourceSha:"h".repeat(40)},"source_identity"],
  [{...valid(),arch:"x64"},"platform_or_channel"],
  [{...valid(),channel:"nightly"},"platform_or_channel"],
  [{...valid(),platform:"win32"},"platform_or_channel"],
  [{...valid(),artifact:{...valid().artifact,url:"http://aoe2war.com/downloads/AoE2HDBets%20Watcher-1.6.6-arm64.zip"}},"artifact_origin"],
  [{...valid(),artifact:{...valid().artifact,url:"https://evil.example/downloads/AoE2HDBets%20Watcher-1.6.6-arm64.zip"}},"artifact_origin"],
  [{...valid(),artifact:{...valid().artifact,url:"https://aoe2war.com.evil.example/downloads/AoE2HDBets%20Watcher-1.6.6-arm64.zip"}},"artifact_origin"],
  [{...valid(),artifact:{...valid().artifact,url:"https://aoe2war.com/downloads/AoE2HDBets%20Watcher-1.6.6-arm64.zip?token=1"}},"artifact_origin"],
  [{...valid(),artifact:{...valid().artifact,name:"../../Watcher.app"}},"artifact_name"],
  [{...valid(),artifact:{...valid().artifact,bytes:999}},"artifact_size_or_hash"],
  [{...valid(),artifact:{...valid().artifact,sha256:"0".repeat(63)}},"artifact_size_or_hash"],
 ];
 for (const [value,reason] of cases) assert.equal(verify(sign(value)).reason,reason,reason);
});

test("malformed envelopes, extra fields and forged payload types fail closed",()=>{
 for(const bytes of [
   Buffer.alloc(0),Buffer.alloc(17_000),Buffer.from("not-json"),
   Buffer.from("{}"),Buffer.from('{"payload":"!!!","signature":"!!!"}'),
   Buffer.from(JSON.stringify({payload:"YQ==",signature:"YQ==",extra:true})),
 ]) assert.equal(verify(bytes).verified,false);
 const wrong={...valid(),extra:"unexpected"};
 assert.equal(verify(sign(wrong)).reason,"manifest_fields");
 const malformed=Buffer.from(JSON.stringify({schema:1})+" ");
 const envelope=Buffer.from(JSON.stringify({
   payload:malformed.toString("base64"),
   signature:crypto.sign(null,malformed,privateKey).toString("base64"),
 }));
 assert.equal(verify(envelope).reason,"noncanonical_payload");
});

test("signature is not bypassed by unrelated key algorithm",()=>{
 const rsa=crypto.generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({type:"spki",format:"pem"});
 assert.equal(verify(sign(),"1.6.5",rsa).verified,false);
});

test("verified manifest is immutable and cannot be spoofed through a plain object",()=>{
  const result=verify(sign());
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.manifest),true);
  assert.equal(Object.isFrozen(result.manifest.artifact),true);
  assert.equal(verifyDownloadedArtifactBytes({...result},artifact),false);
  assert.equal(verifyDownloadedArtifactBytes({verified:true,manifest:result.manifest},artifact),false);
  assert.equal(verifyDownloadedArtifactBytes(result,artifact),true);
});

test("large staged Mac archives use streaming no-follow verification",async(t)=>{
  if(process.platform==="win32" || !fs.constants.O_NOFOLLOW) {
    t.skip("O_NOFOLLOW is mandatory for the Mac streaming file proof");
    return;
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-mac-update-hash-"));
  const real=path.join(dir,"staged.zip");
  const link=path.join(dir,"link.zip");
  try{
    fs.writeFileSync(real,artifact);
    fs.symlinkSync(real,link);
    const proof=verify(sign());
    assert.equal(await verifyDownloadedArtifactFile(proof,real),true);
    assert.equal(await verifyDownloadedArtifactFile(proof,link),false);
    assert.equal(await verifyDownloadedArtifactFile({...proof},real),false);
    assert.equal(await verifyDownloadedArtifactFile(proof,dir),false);
    const mutated=Buffer.from(artifact);mutated[0]^=1;
    fs.writeFileSync(real,mutated);
    assert.equal(await verifyDownloadedArtifactFile(proof,real),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
