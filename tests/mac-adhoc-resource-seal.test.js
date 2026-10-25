"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {spawnSync}=require("node:child_process");
const root=path.join(__dirname,"..");
const script=fs.readFileSync(path.join(root,"scripts/verify-mac-adhoc-seal.sh"),"utf8");
const candidate=fs.readFileSync(path.join(root,".github/workflows/ci.yml"),"utf8");
const publisher=fs.readFileSync(path.join(root,".github/workflows/build-nonwindows-release.yml"),"utf8");
test("macOS candidate and unsigned publisher explicitly request an ad-hoc identity",()=>{
  for(const workflow of [candidate,publisher]){
    assert.match(workflow,/npm run dist:mac -- --(?:publish never --)?config\.mac\.identity=-/);
    assert.match(workflow,/MAC_UNSIGNED_DMG_ZIP_SEAL_AND_PAYLOAD_PARITY_PASS/);
    assert.match(workflow,/verify-mac-adhoc-seal\.sh.*\.app/);
    assert.match(workflow,/hdiutil attach -quiet -readonly -nobrowse -noautoopen/);
    assert.match(workflow,/cmp -s "\$app\/\$file"/);
  }
});
test("credential-free PR macOS job opts into ad-hoc signing without publisher credentials",()=>{
  const mac=candidate.slice(candidate.indexOf("  macos-video-package:"));
  assert.match(mac,/contents: read/);
  assert.match(mac,/CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(mac,/CSC_FOR_PULL_REQUEST: "true"/);
  assert.match(mac,/--config\.mac\.identity=-/);
  assert.doesNotMatch(mac,/CSC_LINK:|CSC_KEY_PASSWORD:|APPLE_APP_SPECIFIC_PASSWORD:|APPLE_TEAM_ID:/);
});
test("seal checker rejects absence and bogus identity rather than trusting an archive checksum",()=>{
  assert.match(script,/Contents\/_CodeSignature\/CodeResources/);
  assert.match(script,/! -s "\$seal"/);
  assert.match(script,/plutil -lint/);
  assert.match(script,/codesign --verify --deep --strict/);
  assert.match(script,/Signature=adhoc/);
  assert.match(script,/TeamIdentifier=not set/);
  assert.match(script,/Sealed Resources version=2/);
  assert.match(script,/APPLE_DEVELOPER_ID_OR_NOTARIZATION=NOT_CLAIMED/);
});
test("real macOS checker refuses a bundle with missing resource seal", {skip:process.platform!=="darwin"},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-adhoc-seal-"));
  try{
    const app=path.join(dir,"Watcher.app");
    fs.mkdirSync(path.join(app,"Contents","MacOS"),{recursive:true});
    const p=spawnSync("bash",[path.join(root,"scripts/verify-mac-adhoc-seal.sh"),app],{encoding:"utf8",timeout:10000});
    assert.equal(p.status,3,p.stderr);
    assert.match(p.stderr,/resource seal missing/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
