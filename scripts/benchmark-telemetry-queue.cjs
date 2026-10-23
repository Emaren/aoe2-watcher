"use strict";

// Reproducible isolated Node component microbenchmark, NOT a physical Electron
// Watcher power or game upload benchmark. It uses a temporary local queue.
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {performance,monitorEventLoopDelay}=require("node:perf_hooks");

async function main() {
  const modulePath=process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname,"..","telemetryQueue.js");
  const n=Number(process.argv[3]||100);
  if(!Number.isSafeInteger(n)||n<1||n>2000)throw new Error("Iterations must be 1..2000");
  const {createDurableTelemetryQueue}=require(modulePath);
  if(typeof createDurableTelemetryQueue!=="function")throw new Error("Invalid queue module");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"aoe2war-telemetry-benchmark-"));
  const filePath=path.join(temp,"queue.json");
  const monitor=monitorEventLoopDelay({resolution:10});
  let ticks=0,maxTimerLagMs=0;
  let last=performance.now();
  let timer;
  try {
    const queue=createDurableTelemetryQueue({filePath,maxEntries:Math.max(1000,n)});
    const before=process.memoryUsage().rss;
    const start=performance.now();
    const startUtilization=performance.eventLoopUtilization();
    monitor.enable();
    timer=setInterval(()=>{
      const now=performance.now();
      const delta=now-last-10;
      if(delta>maxTimerLagMs)maxTimerLagMs=delta;
      last=now;ticks+=1;
    },10);
    const payload="x".repeat(1024);
    for(let i=0;i<n;i++) {
      await queue.enqueue({
        id:"bench-"+i,eventType:"heartbeat",
        payload:{event_type:"heartbeat",metadata:{source:"synthetic-local",payload,sequence:i}},
      });
    }
    const ready=await queue.size();
    const response=await queue.flush(async()=>({ok:true}),{limit:n});
    await new Promise(resolve=>setTimeout(resolve,25)); // observe last pending timer tick
    const elapsedMs=performance.now()-start;
    const utilization=performance.eventLoopUtilization(startUtilization);
    monitor.disable();
    if(timer){clearInterval(timer);timer=null;}
    if(ready!==n || response.delivered!==n || await queue.size()!==0) {
      throw new Error("Benchmark invalid: queue correctness contract failed");
    }
    const stats={
      schema:1,kind:"node-component-microbenchmark",module:path.basename(modulePath),
      platform:process.platform,node:process.version,iterations:n,
      operation:"serialized enqueue + durable flush",eventPayloadBytes:1024,
      durationMs:Math.round(elapsedMs*100)/100,
      mainLoopActiveFraction:Math.round(utilization.utilization*10000)/10000,
      eventLoopDelayP95Ms:Math.round(monitor.percentile(95)/1e6*100)/100,
      eventLoopDelayMaxMs:Math.round(monitor.max/1e6*100)/100,
      maxTimerLagMs:Math.round(maxTimerLagMs*100)/100,
      observedTimerTicks:ticks,
      rssDeltaMb:Math.round((process.memoryUsage().rss-before)/1048576*100)/100,
      delivered:response.delivered,remaining:response.remaining,
      claim:"Measures Node.js diagnostic queue only; not actual app CPU, NIC bandwidth or power.",
    };
    process.stdout.write(JSON.stringify(stats)+"\n");
  } finally {
    if(timer)clearInterval(timer);
    monitor.disable();
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
