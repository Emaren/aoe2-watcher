"use strict";
// No unactivated unsigned-Mac installer code or offline signing key tooling
// should ship in the 1.6.6 desktop candidate merely because source tests use it.
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const main=fs.readFileSync(path.join(root,"main.js"),"utf8");
const modules=[
  "macUnsignedUpdateManifest.js",
  "macUnsignedUpdateStaging.js",
  "macUnsignedUpdateTransaction.js",
  "macUnsignedUpdateJournal.js",
  "macUnsignedUpdateBundleAudit.js",
  "macUnsignedUpdateSwapRehearsal.js",
];
test("disconnected Mac installer components are source-tested but not included in desktop distributables",()=>{
  for(const moduleName of modules){
    assert.equal(fs.existsSync(path.join(root,moduleName)),true);
    assert.equal(pkg.build.files.includes(moduleName),false,moduleName);
    assert.equal(main.includes(moduleName),false,"main cannot activate an unshipped module");
  }
  assert.equal(pkg.build.files.some(x=>x.includes("sign-mac-release")),false);
  assert.equal(pkg.build.files.some(x=>x.includes("private-key")||x.includes(".pem")),false);
});
test("unsigned Mac auto-update gate remains protected in the shipping policy",()=>{
  const policy=fs.readFileSync(path.join(root,"updatePolicy.js"),"utf8");
  assert.match(policy,/mac_manual_unsigned/);
  assert.match(policy,/verifyMacUpdateIdentity/);
  assert.match(main,/AOE2_ENABLE_MAC_AUTO_UPDATE/);
  assert.equal(pkg.version,"1.6.5","release still requires explicit version campaign");
});
