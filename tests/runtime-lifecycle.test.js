const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "main.js"),
  "utf8"
);

test("background watcher is independent from dashboard lifetime", () => {
  assert.match(source, /function createTray\(\)/);
  assert.match(source, /function initializeWatcherRuntime\(\)/);
  assert.match(source, /shouldLaunchInBackground/);
  assert.match(source, /sandbox: true/);
  assert.match(source, /backgroundThrottling: true/);

  const start = source.indexOf('app.on("window-all-closed"');
  const end = source.indexOf("const gotSingleInstanceLock", start);
  assert.ok(start >= 0 && end > start);
  const closeBlock = source.slice(start, end);
  assert.doesNotMatch(closeBlock, /app\.quit\(\)/);
  assert.match(closeBlock, /before-quit/);
});


test("runtime journal batches diagnostic disk writes instead of synchronously appending every event", () => {
  assert.match(
    source,
    /RUNTIME_EVENT_JOURNAL_FLUSH_MS/
  );
  assert.match(
    source,
    /RUNTIME_EVENT_JOURNAL_BUFFER_MAX_BYTES/
  );
  assert.match(
    source,
    /fs\.promises\.appendFile/
  );

  const journalStart =
    source.indexOf(
      "function appendRuntimeEventJournal"
    );
  const journalEnd =
    source.indexOf(
      "function handleWatcherRuntimeEvent",
      journalStart
    );
  const journal =
    source.slice(
      journalStart,
      journalEnd
    );

  assert.doesNotMatch(
    journal,
    /fs\.appendFileSync/
  );
  assert.match(
    journal,
    /scheduleRuntimeEventJournalFlush/
  );
  assert.match(
    source,
    /flushRuntimeEventJournalSync\(\)/
  );
});
