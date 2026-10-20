"use strict";
const fs=require("node:fs");

function parseFile(file) {
 const rows=fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
 if(rows.length<2)throw new Error("Missing independent benchmark repetitions");
 for(const row of rows) {
   if(row.schema!==1||row.kind!=="node-component-microbenchmark"||
      row.delivered!==200||row.remaining!==0||row.iterations!==200) {
     throw new Error("Invalid benchmark correctness receipt");
   }
 }
 return rows;
}
function median(xs) {
 const sorted=[...xs].sort((a,b)=>a-b);
 const n=sorted.length;
 return n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
}
function clean(n) { return Math.round(n*100)/100; }
function run(args) {
 if(args.length!==2)throw Error("Usage: summary baseline.jsonl candidate.jsonl");
 const base=parseFile(args[0]),candidate=parseFile(args[1]);
 if(base.length!==candidate.length)throw Error("Unpaired iteration counts");
 const metrics=[
  ["durationMs","Duration (ms)"],
  ["mainLoopActiveFraction","Event loop active fraction"],
  ["eventLoopDelayP95Ms","Event loop delay p95 (ms)"],
  ["eventLoopDelayMaxMs","Event loop delay max (ms)"],
  ["maxTimerLagMs","Observed timer lag max (ms)"],
  ["rssDeltaMb","RSS delta (MiB)"],
 ];
 const lines=[
  "## Watcher telemetry queue: pinned published 1.6.5 versus candidate",
  "",
  "Synthetic serialized diagnostic-queue benchmark on GitHub-hosted runner, **not installed Watcher performance**.",
  `Trials per version: ${base.length}; entries and deliveries per trial: 200.`,
  "",
  "| Metric | v1.6.5 median | Candidate median |",
  "|---|---:|---:|",
 ];
 for(const [field,label] of metrics) {
  for(const obj of [...base,...candidate])if(!Number.isFinite(obj[field]))throw Error("Invalid metric "+field);
  lines.push(`| ${label} | ${clean(median(base.map(x=>x[field])))} | ${clean(median(candidate.map(x=>x[field])))} |`);
 }
 lines.push("","No release, energy, security, full-device or 100/100 certification follows from this component benchmark.");
 return lines.join("\n")+"\n";
}
try{process.stdout.write(run(process.argv.slice(2)))}catch(e){console.error(e.message);process.exitCode=1}
