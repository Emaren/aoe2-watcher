"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../.github/workflows/finalize-watcher-v165.yml"),"utf8");
test("finalization is pinned to the existing exact draft and source, not arbitrary releases",()=>{
 for(const token of ["RELEASE_ID: \"417695236\"","CERTIFIED_BUNDLE_RUN_ID: \"39316285140\"",
   "WINDOWS_RUN_ID: \"39315028329\"","NONWINDOWS_RUN_ID: \"39315028352\"",
   "BUILD_SOURCE_SHA: \"b49f31bb69fea629378072faa22220cdfcc2f1ef\""])assert.ok(source.includes(token),token);
 assert.ok(source.includes("target_commitish"));
 assert.ok(source.includes("remote.get(\"draft\") is True"));
 assert.ok(source.includes("macos_signature"));
 assert.ok(source.includes("financial_bridge_activation"));
 assert.ok(source.includes("asset.get(\"digest\")"));
 assert.ok(source.includes("actual != expected"));
});
test("draft digest and size comparison must precede publication; Git tag must follow publication",()=>{
 const verify=source.indexOf("name: Verify exact draft files");
 const publish=source.indexOf("name: Publish verified Watcher");
 const tag=source.indexOf("name: Authenticate published release");
 assert.ok(verify>0&&publish>verify&&tag>publish);
 assert.ok(source.includes('p.name.replace(" ", ".")'));
 assert.ok(source.includes("published-tag.json"));
 assert.match(source,/--draft=false/);
 assert.doesNotMatch(source,/gh release create|--clobber/);
});
