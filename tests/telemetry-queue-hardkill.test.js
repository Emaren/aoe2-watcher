"use strict";

// Source/OS-process evidence only: does not qualify power-loss durability,
// native installed Electron clients, real HTTP acknowledgments, or replay finality.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createDurableTelemetryQueue } = require("../telemetryQueue");

const MODULE = path.join(__dirname, "..", "telemetryQueue.js");
const ID = "telemetry_0123456789abcdef0123456789abcdef";
const EVENT = {
  id: ID,
  eventType: "heartbeat",
  payload: { event_type: "heartbeat", metadata: { telemetryEventId: ID } },
};

const CHILD_CODE = [
  '"use strict";',
  'const fs=require("node:fs");',
  'const {createDurableTelemetryQueue}=require(process.argv[1]);',
  'const queuePath=process.argv[2];',
  'const phase=process.argv[3];',
  'const entry=JSON.parse(process.argv[4]);',
  'async function run(){',
  '  const queue=createDurableTelemetryQueue({filePath:queuePath});',
  '  await queue.enqueue(entry);',
  '  if(phase==="after_enqueue"){',
  '    fs.writeSync(1,"QUEUE_PERSISTED\\n");',
  '    process.kill(process.pid,"SIGKILL");',
  '  }else{',
  '    await queue.flush(async()=>{',
  '      fs.writeSync(1,"SENDER_IN_FLIGHT\\n");',
  '      process.kill(process.pid,"SIGKILL");',
  '      return new Promise(()=>{});',
  '    });',
  '  }',
  '  throw Error("child unexpectedly survived its hard-kill point");',
  '}',
  'run().catch(e=>{console.error(e);process.exitCode=27});',
].join("\n");

for (const phase of ["after_enqueue", "send_in_flight"]) {
  test("persisted exact-ID diagnostics recover after process hard kill: " + phase, {timeout: 15000}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-166-hardkill-"));
    const filePath = path.join(directory, "pending.json");
    try {
      const killed = spawnSync(process.execPath,
        ["-e", CHILD_CODE, MODULE, filePath, phase, JSON.stringify(EVENT)],
        {cwd:path.join(__dirname,".."), timeout:10000, encoding:"utf8", windowsHide:true});
      assert.equal(killed.error, undefined, killed.stderr);
      assert.match(killed.stdout, phase === "after_enqueue" ? /QUEUE_PERSISTED/ : /SENDER_IN_FLIGHT/);
      assert.ok(killed.signal || (killed.status !== null && killed.status !== 0),
        "child must die abnormally at the injected kill point");
      assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8"))[0].id, ID);

      // New queue instance must retain the same idempotency key after restart.
      const recovered = createDurableTelemetryQueue({filePath});
      assert.equal(await recovered.size(), 1);
      const retryIds = [];
      const failed = await recovered.flush(async item => {
        retryIds.push(item.id);
        return {ok:false, retryable:true};
      });
      assert.equal(failed.delivered, 0);
      assert.equal(failed.remaining, 1);
      assert.equal(await recovered.size(), 1);
      const success = await recovered.flush(async item => {
        retryIds.push(item.id);
        return {ok:true};
      });
      assert.deepEqual(retryIds, [ID, ID]);
      assert.equal(success.delivered, 1);
      assert.equal(success.remaining, 0);
      assert.equal(fs.existsSync(filePath), false);
    } finally {
      fs.rmSync(directory, {recursive:true, force:true});
    }
  });
}
