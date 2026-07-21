const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readQueueFile(filePath, maxAgeMs, now = Date.now()) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return [];
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      const queuedAt = Number(entry.queuedAtMs || 0);

      return (
        queuedAt > 0 &&
        now - queuedAt <= maxAgeMs &&
        entry.payload &&
        typeof entry.payload === "object"
      );
    });
  } catch {
    return [];
  }
}

function writeQueueFile(filePath, entries) {
  if (!filePath) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  const tempPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tempPath,
    `${JSON.stringify(entries, null, 2)}\n`,
    "utf8"
  );

  fs.renameSync(tempPath, filePath);
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
        const entries = readQueueFile(
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

        writeQueueFile(
          filePath,
          bounded
        );

        return bounded.length;
      });
    },

    flush(sender, { limit = 100 } = {}) {
      return run(async () => {
        const entries = readQueueFile(
          filePath,
          maxAgeMs
        );

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

        writeQueueFile(
          filePath,
          remaining
        );

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
        return readQueueFile(
          filePath,
          maxAgeMs
        ).length;
      });
    },
  };
}

module.exports = {
  createDurableTelemetryQueue,
};
