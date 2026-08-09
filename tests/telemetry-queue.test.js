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
