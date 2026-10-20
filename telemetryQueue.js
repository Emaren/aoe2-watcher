const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RUNTIME_EVENT_COALESCE_WINDOW_MS = 30 * 1000;
const DEFAULT_RUNTIME_EVENT_COALESCE_MAX_KEYS = 512;

function runtimeEventKey(event) {
  const replayIdentity =
    event?.filePath ||
    event?.fileName;

  if (!replayIdentity) {
    return null;
  }

  return `${event.type}:${event.reason}:${replayIdentity}`;
}

function createRuntimeEventCoalescer({
  windowMs =
    DEFAULT_RUNTIME_EVENT_COALESCE_WINDOW_MS,
  maxKeys = DEFAULT_RUNTIME_EVENT_COALESCE_MAX_KEYS,
  now = Date.now,
} = {}) {
  const effectiveWindowMs =
    Number.isFinite(windowMs) &&
    windowMs > 0
      ? windowMs
      : DEFAULT_RUNTIME_EVENT_COALESCE_WINDOW_MS;
  // Every distinct monitored replay used to stay in this Map forever unless
  // its own monitor-stop arrived. A long-lived Watcher must never accumulate
  // unbounded unique filename keys. Eviction can only cause an extra harmless
  // diagnostic event; it never hides a finality/upload transition.
  const effectiveMaxKeys =
    Number.isFinite(maxKeys)
      ? Math.max(1, Math.min(4096, Math.floor(maxKeys)))
      : DEFAULT_RUNTIME_EVENT_COALESCE_MAX_KEYS;
  const observed = new Map();

  function retainMostRecent(key, record) {
    // Map iteration is insertion ordered; deleting and re-inserting moves
    // active keys to the back without a separate timer or scan.
    observed.delete(key);
    while (observed.size >= effectiveMaxKeys) {
      observed.delete(observed.keys().next().value);
    }
    observed.set(key, record);
  }

  function clearReplay(event) {
    const replayIdentity =
      event?.filePath ||
      event?.fileName;

    if (!replayIdentity) {
      return;
    }

    for (const key of observed.keys()) {
      if (key.endsWith(`:${replayIdentity}`)) {
        observed.delete(key);
      }
    }
  }

  return {
    retainedKeyCount() {
      return observed.size;
    },
    coalesce(event) {
      if (
        event?.type === "monitor-stop"
      ) {
        clearReplay(event);
        return event;
      }

      if (
        event?.type !==
          "replay-detected-ignored" ||
        event?.reason !== "monitoring"
      ) {
        return event;
      }

      const key = runtimeEventKey(event);

      if (!key) {
        return event;
      }

      const observedAt = Number(now());
      const prior = observed.get(key);

      if (
        prior &&
        observedAt - prior.emittedAt <
          effectiveWindowMs
      ) {
        prior.suppressedCount += 1;
        retainMostRecent(key, prior);
        return null;
      }

      const coalescedCount =
        (prior?.suppressedCount || 0) + 1;

      retainMostRecent(key, {
        emittedAt: observedAt,
        suppressedCount: 0,
      });

      return {
        ...event,
        coalescedCount,
        coalescedWindowMs:
          effectiveWindowMs,
      };
    },
  };
}

// Persistent diagnostics are best-effort, but an unreadable queue must NEVER
// be mistaken for an empty queue and overwritten. Replays are handled elsewhere.
const MAX_QUEUE_FILE_BYTES = 16 * 1024 * 1024;

function unreadableQueue(reason) {
  const error = new Error("Watcher telemetry queue unavailable: " + reason);
  error.code = "AOE2_TELEMETRY_QUEUE_UNREADABLE";
  return error;
}

async function readQueueFile(filePath, maxAgeMs, now = Date.now()) {
  if (!filePath) return { entries: [], exists: false };

  let raw;
  let handle;
  try {
    // macOS/Linux: O_NOFOLLOW protects the actual opened inode, not merely a
    // pathname checked before opening. Windows lacks this flag; retain lstat
    // refusal there and qualify its native ACLs separately.
    if (!fs.constants.O_NOFOLLOW) {
      const before = await fs.promises.lstat(filePath);
      if (!before.isFile() || before.isSymbolicLink()) {
        throw unreadableQueue("not a regular file");
      }
    }
    handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_QUEUE_FILE_BYTES) {
      throw unreadableQueue("not a regular file or beyond safe read limit");
    }
    const bytes = await handle.readFile();
    // If the queue grows while reading, never parse/rewrite an unbounded
    // partial snapshot. Preserve on-disk evidence instead.
    if (bytes.length !== stat.size || bytes.length > MAX_QUEUE_FILE_BYTES) {
      throw unreadableQueue("queue changed during read; preserved original");
    }
    raw = bytes.toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { entries: [], exists: false };
    if (error?.code === "ELOOP") {
      throw unreadableQueue("symlinked telemetry queue refused");
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadableQueue("invalid JSON; preserved original queue file");
  }
  if (!Array.isArray(parsed)) {
    throw unreadableQueue("invalid queue structure; preserved original queue file");
  }

  // Valid JSON is not necessarily a valid queue. A partially damaged array
  // must not be rewritten while quietly losing its malformed entries.
  // Age-expired *well-formed* events retain the established retention policy.
  const entries = [];
  for (const [index, entry] of parsed.entries()) {
    const queuedAt = Number(entry?.queuedAtMs || 0);
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      !Number.isFinite(queuedAt) || queuedAt <= 0 ||
      !entry.payload || typeof entry.payload !== "object" ||
      Array.isArray(entry.payload)
    ) {
      throw unreadableQueue(`invalid event at index ${index}; preserved original queue file`);
    }
    if (now - queuedAt <= maxAgeMs) entries.push(entry);
  }
  return { entries, exists: true };
}

async function writeQueueFile(filePath, entries) {
  if (!filePath) return;
  if (!Array.isArray(entries) || entries.length === 0) {
    await fs.promises.rm(filePath, { force: true });
    return;
  }

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  try {
    // A queue includes player/session diagnostics; never let the host umask
    // create a world-readable temporary or persisted queue.
    await fs.promises.writeFile(tempPath, `${JSON.stringify(entries)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function createDurableTelemetryQueue({
  filePath,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  let operation = Promise.resolve();

  function run(task) {
    const next = operation.then(task, task);

    operation = next.catch(() => {});

    return next;
  }

  return {
    enqueue(entry) {
      return run(async () => {
        const { entries } = await readQueueFile(
          filePath,
          maxAgeMs
        );

        entries.push({
          ...entry,
          queuedAtMs:
            Number(entry?.queuedAtMs) ||
            Date.now(),
        });

        const bounded =
          entries.slice(-maxEntries);

        await writeQueueFile(
          filePath,
          bounded
        );

        return bounded.length;
      });
    },

    flush(sender, { limit = 100 } = {}) {
      return run(async () => {
        const { entries, exists } = await readQueueFile(
          filePath,
          maxAgeMs
        );

        if (entries.length === 0) {
          if (exists) {
            await writeQueueFile(filePath, []);
          }

          return {
            attempted: 0,
            delivered: 0,
            dropped: 0,
            remaining: 0,
          };
        }

        const remaining = [];

        let attempted = 0;
        let delivered = 0;
        let dropped = 0;

        for (
          let index = 0;
          index < entries.length;
          index += 1
        ) {
          const entry = entries[index];

          if (attempted >= limit) {
            remaining.push(
              ...entries.slice(index)
            );
            break;
          }

          attempted += 1;

          let result;

          try {
            result = await sender(entry);
          } catch {
            result = {
              ok: false,
              retryable: true,
            };
          }

          if (result?.ok) {
            delivered += 1;
            continue;
          }

          if (result?.retryable === false) {
            dropped += 1;
            continue;
          }

          remaining.push(
            entry,
            ...entries.slice(index + 1)
          );

          break;
        }

        const queueChanged =
          delivered > 0 ||
          dropped > 0 ||
          remaining.length !== entries.length;

        if (queueChanged) {
          await writeQueueFile(
            filePath,
            remaining
          );
        }

        return {
          attempted,
          delivered,
          dropped,
          remaining: remaining.length,
        };
      });
    },

    size() {
      return run(async () => {
        const { entries } = await readQueueFile(filePath, maxAgeMs);
        return entries.length;
      });
    },
  };
}

module.exports = {
  DEFAULT_RUNTIME_EVENT_COALESCE_MAX_KEYS,
  createDurableTelemetryQueue,
  createRuntimeEventCoalescer,
};
