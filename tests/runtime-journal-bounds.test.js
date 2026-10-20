"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const {createBoundedPendingJournalWrites}=require("../runtimeJournalQueue");

test("journal queue preserves FIFO and exact JSONL chunks while space is available",()=>{
 const queue=createBoundedPendingJournalWrites({maxBytes:128});
 const a=JSON.stringify({event:"monitor_start"})+"\n";
 const b=JSON.stringify({event:"upload_success"})+"\n";
 queue.push(a);queue.push(b);
 assert.equal(queue.peek(),a);
 assert.equal(queue.shift(),a);
 assert.equal(queue.shift(),b);
 assert.equal(queue.shift(),undefined);
 assert.equal(queue.stats().pendingBytes,0);
});

test("failed disk writes cannot retain unlimited diagnostic chunks",()=>{
 const notices=[];
 const queue=createBoundedPendingJournalWrites({maxBytes:128,onDrop:x=>notices.push(x)});
 for(let i=0;i<5000;i++)queue.push(JSON.stringify({at:i,message:"x".repeat(60)})+"\n");
 const metrics=queue.stats();
 assert.ok(metrics.pendingBytes<=128);
 assert.ok(metrics.queuedChunks<=2);
 assert.ok(metrics.droppedChunks>0);
 assert.ok(metrics.droppedBytes>0);
 assert.ok(notices.length>0);
});

test("oversize UTF-8 chunks are discarded as a whole, never written as malformed JSONL",()=>{
 const queue=createBoundedPendingJournalWrites({maxBytes:12});
 queue.push(JSON.stringify({emoji:"⚔️"})+"\n");
 assert.equal(queue.length,0);
 assert.ok(queue.stats().droppedBytes>12);
 queue.push("{}\n");
 assert.equal(queue.peek(),"{}\n");
});

test("poisoned drop callback cannot crash the watcher journal queue",()=>{
 const queue=createBoundedPendingJournalWrites({maxBytes:5,onDrop:()=>{throw Error("callback");}});
 queue.push("abc\n");
 queue.push("def\n");
 assert.equal(queue.peek(),"def\n");
 assert.equal(queue.stats().droppedChunks,1);
});

test("main reuses bounded diagnostic ring in async and quit-drain paths",()=>{
 const src=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
 assert.match(src,/createBoundedPendingJournalWrites/);
 assert.equal((src.match(/runtimeJournalPendingWrites\.peek\(\)/g)||[]).length,2);
 assert.match(src,/runtimeJournalPendingWrites\.shift\(\)/);
 assert.match(src,/runtimeJournalPendingWrites\.push\(chunk\)/);
 assert.match(src,/runtimeJournalPendingWrites\.push\(runtimeEventJournalBuffer\)/);
});
