"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const crypto=require("node:crypto");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {Readable}=require("node:stream");
const {
  verifySignedMacReleaseEnvelope,
  isAuthenticatedMacReleaseProof,
}=require("../macUnsignedUpdateManifest");
const {stageVerifiedMacArchive}=require("../macUnsignedUpdateStaging");

const archive=Buffer.alloc(1024*1024,0x46);
const sha=crypto.createHash("sha256").update(archive).digest("hex");
const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const publicPem=publicKey.export({type:"spki",format:"pem"});
const manifest={
  schema:1,channel:"stable",platform:"darwin",arch:"arm64",version:"1.6.6",
  sourceSha:"ab".repeat(20),
  artifact:{
    name:"AoE2HDBets Watcher-1.6.6-arm64-mac.zip",bytes:archive.length,sha256:sha,
    url:"https://aoe2war.com/downloads/AoE2HDBets%20Watcher-1.6.6-arm64-mac.zip",
  },
};
const payload=Buffer.from(JSON.stringify(manifest),"utf8");
const envelope=Buffer.from(JSON.stringify({
  payload:payload.toString("base64"),
  signature:crypto.sign(null,payload,privateKey).toString("base64"),
}),"utf8");
const proof=verifySignedMacReleaseEnvelope({
  envelopeBytes:envelope,currentVersion:"1.6.5",targetArch:"arm64",
  pinnedPublicKeyPem:publicPem,
});
function fakeResponse({body=archive,statusCode=200,headers={}}={}) {
  return async()=>({
    statusCode,
    headers:{"content-type":"application/zip","content-length":String(body.length),...headers},
    body:Readable.from([body]),
  });
}
function privateFolder(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-stage-test-"));
  fs.chmodSync(dir,0o700);
  return dir;
}
const macOnly=process.platform==="win32"||!fs.constants.O_NOFOLLOW;
test("authenticated proof is not forgeable by a copied object",()=>{
  assert.equal(isAuthenticatedMacReleaseProof(proof),true);
  assert.equal(isAuthenticatedMacReleaseProof({...proof}),false);
  assert.equal(isAuthenticatedMacReleaseProof({verified:true,manifest}),false);
});
test("stages exactly signed bytes under owner-private per-attempt directory", {skip:macOnly}, async()=>{
  const dir=privateFolder();
  try {
    let requestedUrl;
    const staged=await stageVerifiedMacArchive({
      verifiedManifest:proof,userDataDir:dir,
      openResponse:async({url})=>{requestedUrl=url;return fakeResponse()();},
    });
    assert.equal(requestedUrl,manifest.artifact.url);
    assert.equal(staged.bytes,archive.length);
    assert.equal(staged.sha256,sha);
    assert.equal(staged.version,"1.6.6");
    assert.deepEqual(fs.readFileSync(staged.archivePath),archive);
    assert.equal(fs.statSync(staged.stageDir).mode&0o077,0);
    assert.equal(fs.statSync(staged.archivePath).mode&0o077,0);
    assert.equal(fs.readdirSync(staged.stageDir).length,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
});
test("invalid transport, content type, size, checksum and redirect remove the failed stage", {skip:macOnly}, async()=>{
  const variants=[
    {statusCode:302,headers:{location:"https://hostile.example/file.zip"}},
    {headers:{"content-type":"text/html"}},
    {headers:{"content-encoding":"gzip"}},
    {headers:{"content-length":"1"}},
    {body:archive.subarray(1),headers:{"content-length":String(archive.length)}},
    {body:Buffer.concat([archive,Buffer.from([1])]),headers:{"content-length":String(archive.length)}},
    {body:Buffer.alloc(archive.length,0x42)},
  ];
  for (const config of variants) {
    const dir=privateFolder();
    try {
      await assert.rejects(stageVerifiedMacArchive({
        verifiedManifest:proof,userDataDir:dir,openResponse:fakeResponse(config),
      }));
      assert.deepEqual(fs.readdirSync(path.join(dir,"watcher-update-staging")),[]);
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  }
});
test("symlink staging root and forged release proof fail closed", {skip:macOnly}, async()=>{
  const dir=privateFolder(),external=privateFolder();
  try {
    await assert.rejects(stageVerifiedMacArchive({
      verifiedManifest:{...proof},userDataDir:dir,openResponse:fakeResponse(),
    }),/unauthenticated_release/);
    fs.symlinkSync(external,path.join(dir,"watcher-update-staging"));
    await assert.rejects(stageVerifiedMacArchive({
      verifiedManifest:proof,userDataDir:dir,openResponse:fakeResponse(),
    }),/directory_is_not_real/);
    assert.deepEqual(fs.readdirSync(external),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true})}
});
test("no oversized buffers, shell, arbitrary redirect or installer launch in staging code",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","macUnsignedUpdateStaging.js"),"utf8");
  assert.match(source,/for await \(const chunk of response\.body\)/);
  assert.match(source,/fs\.constants\.O_NOFOLLOW/);
  assert.match(source,/crypto\.timingSafeEqual/);
  assert.doesNotMatch(source,/spawn\(|exec\(|quitAndInstall|extract\(|unzip\(/);
});
