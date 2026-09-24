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
  const end = source.indexOf('app.on("activate"', start);
  assert.ok(start >= 0 && end > start);
  const closeBlock = source.slice(start, end);
  assert.doesNotMatch(closeBlock, /app\.quit\(\)/);

  const beforeQuit = source.indexOf('app.on("before-quit"', end);
  assert.ok(beforeQuit > end);
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

test("graceful quit drains queued journal writes before the final watcher stop flush", () => {
  const quitStart = source.indexOf('app.on("before-quit"');
  const quitEnd = source.indexOf("const gotSingleInstanceLock", quitStart);
  const quitBlock = source.slice(quitStart, quitEnd);

  assert.match(quitBlock, /event\.preventDefault\(\)/);
  assert.match(quitBlock, /flushRuntimeEventJournal\(\)/);
  assert.match(quitBlock, /runtimeJournalQuitDrainComplete = true/);
  assert.match(quitBlock, /app\.quit\(\)/);

  const stop = quitBlock.indexOf("stopCurrentWatcher");
  const finalFlush = quitBlock.indexOf("flushRuntimeEventJournalSync");
  assert.ok(stop >= 0);
  assert.ok(finalFlush > stop);
});

test("update installation drains the journal before quitAndInstall", () => {
  const installStart = source.indexOf(
    "async function installDownloadedWatcherUpdate"
  );
  const installEnd = source.indexOf(
    "function maybeInstallPendingWatcherUpdate",
    installStart
  );
  const block = source.slice(installStart, installEnd);

  const stop = block.lastIndexOf("stopCurrentWatcher");
  const drain = block.indexOf("await flushRuntimeEventJournal()", stop);
  const markSafe = block.indexOf(
    "runtimeJournalQuitDrainComplete = true",
    drain
  );
  const install = block.indexOf("autoUpdater.quitAndInstall", markSafe);

  assert.ok(stop >= 0);
  assert.ok(drain > stop);
  assert.ok(markSafe > drain);
  assert.ok(install > markSafe);
});

