"use strict";
// Watcher 1.6.6 golden replay boundary. Byte-identical to published 1.6.5,
// unless an explicit new golden-corpus qualification revises this test.
// Do NOT weaken this gate to make a behavior-affecting refactor look green.
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.join(__dirname,"..");
const BASELINE=Object.freeze({
  "watcher.js":"1ce3db9ec9295eb1b30e00404958972ba02f2d83",
  "replayProvenancePolicy.js":"d3a1f841944bfc8c9bf0bdbf4cb4160962ca41f9",
  "streamHandoff.js":"1fb1e0b02faf14b0b8914339133f73d3b00effad",
  "networkPriority.js":"ac7b7645d093f707d5d0ee83033c5edb35b2c4ce",
  "runtimePolicy.js":"1a37f736ba7750fbbf0f427128ece732004957b4",
});
function gitBlobSha(content){
 return crypto.createHash("sha1")
   .update("blob "+content.length+"\0","utf8").update(content).digest("hex");
}
test("Watcher 1.6.6 replay ingress, hash, retry, handoff and scheduling engines match published 1.6.5 byte-for-byte",()=>{
 for(const [file,sha] of Object.entries(BASELINE)){
  const content=fs.readFileSync(path.join(ROOT,file));
  assert.equal(gitBlobSha(content),sha,
    file+" changed since published 1.6.5; require explicit gold-corpus evidence and approved source exception");
 }
});
test("baseline pins must be exact Git blob identities, not branch labels or simulated successes",()=>{
 assert.equal(Object.keys(BASELINE).length,5);
 for(const value of Object.values(BASELINE))assert.match(value,/^[0-9a-f]{40}$/);
 const packageVersion=JSON.parse(fs.readFileSync(path.join(ROOT,"package.json"),"utf8")).version;
 assert.equal(packageVersion,"1.6.5","candidate must not pretend to be a published 1.6.6");
});
