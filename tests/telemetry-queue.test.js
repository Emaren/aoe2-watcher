const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createDurableTelemetryQueue,
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
