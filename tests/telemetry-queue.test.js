const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createDurableTelemetryQueue,
  createRuntimeEventCoalescer,
} = require("../telemetryQueue");

function tempQueue() {
  const dir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "aoe2-watcher-telemetry-"
    )
  );

  return {
    dir,
    filePath: path.join(
      dir,
      "queue.json"
    ),
  };
}

test(
  "telemetry queue survives a new queue instance",
  async () => {
    const { filePath } = tempQueue();

    const first =
      createDurableTelemetryQueue({
        filePath,
      });

    await first.enqueue({
      eventType: "upload_failed",
      payload: {
        event_type: "upload_failed",
      },
    });

    const second =
      createDurableTelemetryQueue({
        filePath,
      });

    assert.equal(
      await second.size(),
      1
    );
  }
);

test(
  "successful telemetry flush removes queued event",
  async () => {
    const { filePath } = tempQueue();

    const queue =
      createDurableTelemetryQueue({
        filePath,
      });

    await queue.enqueue({
      eventType: "heartbeat",
      payload: {
        event_type: "heartbeat",
      },
    });

    const result =
      await queue.flush(async () => ({
        ok: true,
      }));

    assert.equal(result.delivered, 1);
    assert.equal(
      await queue.size(),
      0
    );
    assert.equal(
      fs.existsSync(filePath),
      false
    );
  }
);

test(
  "retryable telemetry failure remains queued",
  async () => {
    const { filePath } = tempQueue();

    const queue =
      createDurableTelemetryQueue({
        filePath,
      });

    await queue.enqueue({
      eventType: "upload_failed",
      payload: {
        event_type: "upload_failed",
      },
    });

    const result =
      await queue.flush(async () => ({
        ok: false,
        retryable: true,
      }));

    assert.equal(result.remaining, 1);
    assert.equal(
      await queue.size(),
      1
    );
  }
);

test(
  "non-retryable telemetry failure is discarded",
  async () => {
    const { filePath } = tempQueue();

    const queue =
      createDurableTelemetryQueue({
        filePath,
      });

    await queue.enqueue({
      eventType: "invalid_event",
      payload: {
        event_type: "invalid_event",
      },
    });

    const result =
      await queue.flush(async () => ({
        ok: false,
        retryable: false,
      }));

    assert.equal(result.dropped, 1);
    assert.equal(
      await queue.size(),
      0
    );
  }
);

test(
  "empty telemetry flush does not create an idle queue file",
  async () => {
    const { filePath } = tempQueue();
    const queue =
      createDurableTelemetryQueue({
        filePath,
      });

    const result =
      await queue.flush(async () => ({
        ok: true,
      }));

    assert.equal(result.attempted, 0);
    assert.equal(result.remaining, 0);
    assert.equal(
      fs.existsSync(filePath),
      false
    );
  }
);

test(
  "flush retires a legacy queue file containing only expired entries",
  async () => {
    const { filePath } = tempQueue();

    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          eventType: "old",
          queuedAtMs: 1,
          payload: {
            event_type: "old",
          },
        },
      ]),
      "utf8"
    );

    const queue =
      createDurableTelemetryQueue({
        filePath,
        maxAgeMs: 1000,
      });

    const originalNow = Date.now;
    Date.now = () => 10_000;
    try {
      const result =
        await queue.flush(async () => ({
          ok: true,
        }));

      assert.equal(result.attempted, 0);
      assert.equal(result.remaining, 0);
      assert.equal(
        fs.existsSync(filePath),
        false
      );
    } finally {
      Date.now = originalNow;
    }
  }
);

test(
  "retryable telemetry failure preserves the durable queue without rewriting it",
  async () => {
    const { filePath } = tempQueue();
    const queue =
      createDurableTelemetryQueue({
        filePath,
      });

    await queue.enqueue({
      eventType: "heartbeat",
      payload: {
        event_type: "heartbeat",
      },
    });

    const before =
      fs.readFileSync(filePath);
    const beforeStat =
      fs.statSync(filePath);

    const result =
      await queue.flush(async () => ({
        ok: false,
        retryable: true,
      }));

    const after =
      fs.readFileSync(filePath);
    const afterStat =
      fs.statSync(filePath);

    assert.equal(result.delivered, 0);
    assert.equal(result.dropped, 0);
    assert.equal(result.remaining, 1);
    assert.deepEqual(after, before);

    // Atomic queue rewrites replace the file. Keeping the same inode proves
    // a pure retryable no-progress heartbeat did not churn the durable queue.
    if (
      Number.isFinite(beforeStat.ino) &&
      Number.isFinite(afterStat.ino)
    ) {
      assert.equal(
        afterStat.ino,
        beforeStat.ino
      );
    }
  }
);

test(
  "coalesces repeated monitoring notifications without delaying the first signal",
  () => {
    let now = 1000;
    const coalescer =
      createRuntimeEventCoalescer({
        windowMs: 30000,
        now: () => now,
      });
    const event = {
      type: "replay-detected-ignored",
      reason: "monitoring",
      filePath: "/replays/live.aoe2record",
    };

    assert.deepEqual(
      coalescer.coalesce(event),
      {
        ...event,
        coalescedCount: 1,
        coalescedWindowMs: 30000,
      }
    );

    now += 100;
    assert.equal(
      coalescer.coalesce(event),
      null
    );

    now += 29900;
    assert.deepEqual(
      coalescer.coalesce(event),
      {
        ...event,
        coalescedCount: 2,
        coalescedWindowMs: 30000,
      }
    );
  }
);

test(
  "never coalesces upload or finality transitions",
  () => {
    const coalescer =
      createRuntimeEventCoalescer();

    for (const event of [
      {
        type: "replay-detected",
        filePath: "/replays/live.aoe2record",
      },
      {
        type: "upload-start",
        filePath: "/replays/live.aoe2record",
        parseIteration: 4,
      },
      {
        type: "final-candidate-ready",
        filePath: "/replays/live.aoe2record",
      },
      {
        type: "upload-success",
        filePath: "/replays/live.aoe2record",
        isFinal: true,
      },
    ]) {
      assert.equal(
        coalescer.coalesce(event),
        event
      );
    }
  }
);

test(
  "monitor stop clears the replay coalescing window for a new session",
  () => {
    let now = 1000;
    const coalescer =
      createRuntimeEventCoalescer({
        windowMs: 30000,
        now: () => now,
      });
    const ignored = {
      type: "replay-detected-ignored",
      reason: "monitoring",
      fileName: "live.aoe2record",
    };
    const stopped = {
      type: "monitor-stop",
      fileName: "live.aoe2record",
    };

    assert.ok(coalescer.coalesce(ignored));
    now += 100;
    assert.equal(
      coalescer.coalesce(ignored),
      null
    );
    assert.equal(
      coalescer.coalesce(stopped),
      stopped
    );
    assert.deepEqual(
      coalescer.coalesce(ignored),
      {
        ...ignored,
        coalescedCount: 1,
        coalescedWindowMs: 30000,
      }
    );
  }
);

test(
  "tracks monitoring notifications independently per replay",
  () => {
    const coalescer =
      createRuntimeEventCoalescer();
    const first = {
      type: "replay-detected-ignored",
      reason: "monitoring",
      filePath: "/replays/first.aoe2record",
    };
    const second = {
      ...first,
      filePath: "/replays/second.aoe2record",
    };

    assert.ok(coalescer.coalesce(first));
    assert.ok(coalescer.coalesce(second));
    assert.equal(
      coalescer.coalesce(first),
      null
    );
    assert.equal(
      coalescer.coalesce(second),
      null
    );
  }
);


test(
  "coalescer never retains unbounded unique replays across a long session",
  () => {
    let now = 1000;
    const coalescer = createRuntimeEventCoalescer({
      now: () => now,
    });
    const eventFor = (i) => ({
      type: "replay-detected-ignored",
      reason: "monitoring",
      filePath: `/replays/replay-${i}.aoe2record`,
    });

    for (let i = 0; i < 5000; i += 1) {
      assert.ok(coalescer.coalesce(eventFor(i)));
      assert.ok(coalescer.retainedKeyCount() <= 512);
      now += 1;
    }

    assert.equal(coalescer.retainedKeyCount(), 512);
    // A key evicted long ago should emit the next diagnostic, never suppress.
    assert.ok(coalescer.coalesce(eventFor(0)));
    assert.equal(coalescer.retainedKeyCount(), 512);
    assert.equal(coalescer.coalesce(eventFor(0)), null);
  }
);

test(
  "LRU protection keeps hot replay suppression, bounded oldest eviction and stop reset",
  () => {
    let now = 1000;
    const coalescer = createRuntimeEventCoalescer({
      now: () => now,
      maxKeys: 2,
      windowMs: 30000,
    });
    const event = (name) => ({
      type: "replay-detected-ignored",
      reason: "monitoring",
      fileName: name,
    });
    assert.ok(coalescer.coalesce(event("A")));
    assert.ok(coalescer.coalesce(event("B")));
    assert.equal(coalescer.coalesce(event("A")), null); // A becomes most recent
    assert.ok(coalescer.coalesce(event("C"))); // evicts B, not A
    assert.equal(coalescer.retainedKeyCount(), 2);
    assert.equal(coalescer.coalesce(event("A")), null);
    assert.deepEqual(coalescer.coalesce(event("B")), {
      ...event("B"),
      coalescedCount: 1,
      coalescedWindowMs: 30000,
    });
    assert.equal(coalescer.retainedKeyCount(), 2);
    const stop = { type: "monitor-stop", fileName: "B" };
    assert.deepEqual(coalescer.coalesce(stop), stop);
    assert.deepEqual(coalescer.coalesce(event("B")), {
      ...event("B"),
      coalescedCount: 1,
      coalescedWindowMs: 30000,
    });
  }
);

test(
  "invalid coalescer retention cap clamps safely without changing transition events",
  () => {
    for (const maxKeys of [0, -10, NaN]) {
      const coalescer = createRuntimeEventCoalescer({ maxKeys });
      for (let i = 0; i < 20; i += 1) {
        assert.ok(coalescer.coalesce({
          type: "replay-detected-ignored",
          reason: "monitoring",
          fileName: `file-${i}`,
        }));
      }
      assert.ok(coalescer.retainedKeyCount() <= 512);
      const finality = {
        type: "final-candidate-ready",
        fileName: "file-19",
      };
      assert.equal(coalescer.coalesce(finality), finality);
    }
  }
);

test("corrupt JSON is never silently treated as an empty durable queue", async () => {
  const { filePath } = tempQueue();
  fs.writeFileSync(filePath, "[{broken-json", "utf8");
  const original = fs.readFileSync(filePath, "utf8");
  const queue = createDurableTelemetryQueue({ filePath });
  await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),
    (error) => error.code === "AOE2_TELEMETRY_QUEUE_UNREADABLE");
  await assert.rejects(queue.flush(async()=>({ok:true})),
    (error) => error.code === "AOE2_TELEMETRY_QUEUE_UNREADABLE");
  await assert.rejects(queue.size(),
    (error) => error.code === "AOE2_TELEMETRY_QUEUE_UNREADABLE");
  assert.equal(fs.readFileSync(filePath,"utf8"), original);
});

test("wrong queue JSON structure remains untouched instead of being overwritten", async () => {
  const { filePath } = tempQueue();
  fs.writeFileSync(filePath, '{"entries":[]}',"utf8");
  const queue = createDurableTelemetryQueue({ filePath });
  await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),
    (error) => error.code === "AOE2_TELEMETRY_QUEUE_UNREADABLE");
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath,"utf8")),{entries:[]});
});

test("non-file queue paths fail safely without discarding an existing directory", async () => {
  const { filePath } = tempQueue();
  fs.mkdirSync(filePath);
  const queue = createDurableTelemetryQueue({ filePath });
  await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),
    (error) => error.code === "AOE2_TELEMETRY_QUEUE_UNREADABLE");
  assert.equal(fs.statSync(filePath).isDirectory(),true);
});

test("asynchronous queue persistence retains FIFO and survives rapid concurrent callers", async () => {
  const { filePath } = tempQueue();
  const queue = createDurableTelemetryQueue({ filePath, maxEntries: 100 });
  const entries = Array.from({length:50},(_,i)=>({
    id: "telemetry_" + String(i).padStart(32,"0"),
    eventType: "upload_retry",
    payload: { event_type:"upload_retry", number:i },
  }));
  await Promise.all(entries.map(e=>queue.enqueue(e)));
  const onDisk = JSON.parse(fs.readFileSync(filePath,"utf8"));
  assert.deepEqual(onDisk.map(e=>e.payload.number),entries.map(e=>e.payload.number));
  const restored = createDurableTelemetryQueue({filePath});
  assert.equal(await restored.size(),50);
  const ids=[];
  const result=await restored.flush(async e=>{ids.push(e.id);return {ok:true};});
  assert.equal(result.delivered,50);
  assert.deepEqual(ids,entries.map(e=>e.id));
  assert.equal(fs.existsSync(filePath),false);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter(name=>name.includes(".tmp-")),[]);
});

test("queued retry after read failure does not block future recovery", async () => {
  const {filePath}=tempQueue();
  const queue=createDurableTelemetryQueue({filePath});
  fs.writeFileSync(filePath,"bad","utf8");
  await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}));
  fs.writeFileSync(filePath,"[]","utf8");
  assert.equal(await queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),1);
  assert.equal(await queue.size(),1);
});

test("durable telemetry implementation does not use synchronous filesystem operations in Electron",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","telemetryQueue.js"),"utf8");
  assert.doesNotMatch(source,/fs\.(?:existsSync|readFileSync|writeFileSync|rmSync|renameSync|mkdirSync)\s*\(/);
  const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
  assert.match(main,/Watcher telemetry queue could not flush/);
  assert.match(main,/could not be durably queued/);
});

test("compact atomic persistence keeps legacy pretty JSON readable while reducing disk footprint",async()=>{
 const {filePath}=tempQueue();
 const baseline=[
  {id:"a",eventType:"upload_failed",queuedAtMs:Date.now(),payload:{event_type:"upload_failed",metadata:{detail:"fixture"}}},
  {id:"b",eventType:"upload_succeeded",queuedAtMs:Date.now(),payload:{event_type:"upload_succeeded",metadata:{detail:"fixture"}}},
 ];
 fs.writeFileSync(filePath,JSON.stringify(baseline,null,2)+"\n","utf8");
 const before=fs.statSync(filePath).size;
 const queue=createDurableTelemetryQueue({filePath,maxEntries:100});
 assert.equal(await queue.size(),2);
 await queue.enqueue({id:"c",eventType:"heartbeat",payload:{event_type:"heartbeat"}});
 const bytes=fs.readFileSync(filePath);
 const after=JSON.parse(bytes.toString("utf8"));
 assert.equal(after.length,3);
 assert.deepEqual(after.slice(0,2),baseline);
 assert.ok(bytes.length<Buffer.byteLength(JSON.stringify(after,null,2)+"\n"),"compact format should use fewer bytes for identical entries");
 assert.equal(bytes.toString("utf8").includes("\n  {"),false);
});

test("valid JSON with a malformed row is never silently rewritten or discarded",async()=>{
  const {filePath}=tempQueue();
  const valid={id:"telemetry_valid",eventType:"heartbeat",
    queuedAtMs:Date.now(),payload:{event_type:"heartbeat"}};
  const original=JSON.stringify([valid,null,{queuedAtMs:"bad",payload:{}}])+"\n";
  fs.writeFileSync(filePath,original,"utf8");
  const queue=createDurableTelemetryQueue({filePath});
  await assert.rejects(queue.size(),e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
  await assert.rejects(queue.enqueue({id:"new",eventType:"heartbeat",
    payload:{event_type:"heartbeat"}}),e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
  await assert.rejects(queue.flush(async()=>({ok:true})),
    e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
  assert.equal(fs.readFileSync(filePath,"utf8"),original);
});

test("well-formed expired events still honor the existing retention deadline",async()=>{
  const {filePath}=tempQueue();
  const expired={eventType:"old",queuedAtMs:1,payload:{event_type:"old"}};
  const fresh={eventType:"new",queuedAtMs:Date.now(),payload:{event_type:"new"}};
  fs.writeFileSync(filePath,JSON.stringify([expired,fresh]),"utf8");
  const queue=createDurableTelemetryQueue({filePath,maxAgeMs:60000});
  assert.equal(await queue.size(),1);
  const types=[];
  const res=await queue.flush(async event=>{types.push(event.eventType);return {ok:true};});
  assert.deepEqual(types,["new"]);
  assert.equal(res.delivered,1);
});

test("atomic durable telemetry files are owner-only, even with permissive umask",async()=>{
  if(process.platform==="win32")return; // Windows ACL semantics differ
  const {filePath}=tempQueue();
  const original=process.umask(0o022);
  try {
    const queue=createDurableTelemetryQueue({filePath});
    await queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}});
    assert.equal(fs.statSync(filePath).mode&0o077,0);
    assert.equal(await queue.size(),1);
  } finally {process.umask(original)}
});

test("symlinked durable telemetry queue is rejected and cannot overwrite the link target",async()=>{
  if(process.platform==="win32")return; // ordinary Windows CI lacks symlink privilege
  const {filePath}=tempQueue();
  const target=filePath+".target";
  const original=JSON.stringify([{eventType:"heartbeat",queuedAtMs:Date.now(),
    payload:{event_type:"heartbeat"}}]);
  fs.writeFileSync(target,original);
  fs.symlinkSync(target,filePath);
  const queue=createDurableTelemetryQueue({filePath});
  await assert.rejects(queue.size(),e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
  await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),
    e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
  assert.equal(fs.readFileSync(target,"utf8"),original);
  assert.equal(fs.lstatSync(filePath).isSymbolicLink(),true);
});

test("telemetry queue opens the verified file handle without following POSIX symlinks",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","telemetryQueue.js"),"utf8");
 assert.match(source,/fs\.promises\.open\(/);
 assert.match(source,/fs\.constants\.O_NOFOLLOW/);
 assert.match(source,/await handle\.readFile\(\)/);
 assert.doesNotMatch(source,/fs\.promises\.readFile\(filePath/);
});

test("oversized diagnostic file is rejected before reading and left intact",async()=>{
 const {filePath}=tempQueue();
 fs.writeFileSync(filePath,"");
 fs.truncateSync(filePath,16*1024*1024+1);
 const queue=createDurableTelemetryQueue({filePath});
 await assert.rejects(queue.size(),e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
 await assert.rejects(queue.enqueue({eventType:"heartbeat",payload:{event_type:"heartbeat"}}),
   e=>e.code==="AOE2_TELEMETRY_QUEUE_UNREADABLE");
 assert.equal(fs.statSync(filePath).size,16*1024*1024+1);
});
