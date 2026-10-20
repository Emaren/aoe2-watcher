"use strict";
// CI-only integration proof using a disposable in-memory key pair. No signing
// key or update envelope is written, installed, uploaded or published.
const crypto=require("node:crypto");
const path=require("node:path");
const {signMacRelease}=require("./sign-mac-release.cjs");
const {verifySignedMacReleaseEnvelope,verifyDownloadedArtifactFile}=
  require("../macUnsignedUpdateManifest");

async function main(args){
  if(process.platform!=="darwin")throw Error("Real native updater signing smoke requires macOS");
  if(args.length!==3)throw Error("Need exact ZIP path, stable version and Git build source");
  const [arg,version,sourceSha]=args;
  const archivePath=path.resolve(arg);
  const keys=crypto.generateKeyPairSync("ed25519");
  const privateKeyPem=keys.privateKey.export({type:"pkcs8",format:"pem"});
  const publicPem=keys.publicKey.export({type:"spki",format:"pem"});
  const digest=crypto.createHash("sha256")
    .update(keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
  const {manifest,envelope}=await signMacRelease({
    archivePath,version,arch:"arm64",sourceSha,privateKeyPem,
    approvedPublicSpkiSha256:digest,
  });
  const verified=verifySignedMacReleaseEnvelope({
    envelopeBytes:envelope,currentVersion:"0.0.0",targetArch:"arm64",
    pinnedPublicKeyPem:publicPem,
  });
  if(!verified.verified)throw Error("Client rejected real artifact signing proof: "+verified.reason);
  if(verified.manifest.sourceSha!==sourceSha||
     verified.manifest.artifact.name!==path.basename(archivePath)||
     !(await verifyDownloadedArtifactFile(verified,archivePath))) {
     throw Error("Real native ZIP source, basename or checksum mismatch");
  }
  process.stdout.write("REAL_NATIVE_MAC_ZIP_EPHEMERAL_SIGNING_PASS version="+version+
    " bytes="+manifest.artifact.bytes+" sha256="+manifest.artifact.sha256+"\n");
}
main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
