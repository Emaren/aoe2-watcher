const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createBoundedPendingJournalWrites } = require("../runtimeJournalQueue");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const start = main.indexOf("function getRuntimeEventJournalPath()");
const end = main.indexOf("function handleWatcherRuntimeEvent", start);
assert.ok(start >= 0 && end > start, "Actual runtime journal functions must be present");
const journalSource = main.slice(start, end);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function eventTypes(text) {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line).type);
}

// Execute the owning functions with an in-memory filesystem. Neither the user
// journal nor real updater configuration is accessible from this context.
function createJournal(options = {}) {
  const calls = [];
  const warnings = [];
  const attempts = [];
  const durable = [];
  const timers = new Map();
  let nextTimer = 0;
  let asyncAttempt = 0;
  let syncAttempt = 0;
  let contents = "";
  const record = (name, ...args) => calls.push({ name, args });
  const absent = () => Object.assign(new Error("Journal does not exist"), { code: "ENOENT" });
  const stat = () => {
    if (!contents) throw absent();
    return { size: Buffer.byteLength(contents, "utf8") };
  };
  const committed = (chunk) => {
    durable.push(...eventTypes(chunk));
    contents += chunk;
  };
  const fakeFs = {
    promises: {
      mkdir: async (...args) => record("mkdir", ...args),
      stat: async (...args) => {
        record("stat", ...args);
        return stat();
      },
      appendFile: async (target, chunk, encoding) => {
        record("append", target, chunk, encoding);
        attempts.push(...eventTypes(chunk));
        asyncAttempt += 1;
        if (options.asyncAppend) await options.asyncAppend(asyncAttempt, chunk);
        committed(chunk);
      },
      rm: async (...args) => record("remove", ...args),
      rename: async (...args) => {
        record("rotate", ...args);
        contents = "";
      },
    },
    mkdirSync: (...args) => record("mkdir-sync", ...args),
    statSync: (...args) => {
      record("stat-sync", ...args);
      return stat();
    },
    appendFileSync: (target, chunk, encoding) => {
      record("append-sync", target, chunk, encoding);
      attempts.push(...eventTypes(chunk));
      syncAttempt += 1;
      if (options.syncAppend) options.syncAppend(syncAttempt, chunk);
      committed(chunk);
    },
    rmSync: (...args) => record("remove-sync", ...args),
    renameSync: (...args) => {
      record("rotate-sync", ...args);
      contents = "";
    },
  };
  const context = vm.createContext({
    fs: fakeFs,
    path,
    Buffer,
    createBoundedPendingJournalWrites,
    app: { isReady: () => true, getPath: () => "/test/owned-user-data" },
    console: { warn: (message) => warnings.push(message) },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      record("timer-start", id, delay);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
      record("timer-clear", id);
    },
  });
  vm.runInContext(`
    const WATCHER_VERSION = "1.6.3";
    const APP_SESSION_ID = "test-session";
    const RUNTIME_EVENT_JOURNAL_MAX_BYTES = 100 * 1024 * 1024;
    const RUNTIME_EVENT_JOURNAL_BUFFER_MAX_BYTES = 1024 * 1024;
    const RUNTIME_EVENT_JOURNAL_FLUSH_MS = 2000;
    let runtimeEventJournalBuffer = "";
    let runtimeEventJournalBufferBytes = 0;
    let runtimeEventJournalFlushTimer = null;
    let runtimeEventJournalFlushChain = Promise.resolve();
    let runtimeJournalPendingWrites = createBoundedPendingJournalWrites({ maxBytes: 1024 * 1024 });
    let runtimeJournalLastError = null;
    ${journalSource}
    globalThis.__test = {
      append: appendRuntimeEventJournal,
      flush: flushRuntimeEventJournal,
      flushSync: flushRuntimeEventJournalSync,
      schedule: scheduleRuntimeEventJournalFlush,
      state: () => ({
        buffered: runtimeEventJournalBuffer,
        bufferedBytes: runtimeEventJournalBufferBytes,
        pending: runtimeJournalPendingWrites.snapshot(),
        error: runtimeJournalLastError?.message || null,
        timer: runtimeEventJournalFlushTimer,
      }),
    };
  `, context, { filename: "main.js runtime journal functions" });
  return { api: context.__test, calls, warnings, attempts, durable, timers };
}

test("a failed asynchronous append preserves its evidence before retrying with new events", async () => {
  const journal = createJournal({
    asyncAppend: (attempt) => {
      if (attempt === 1) throw new Error("test transient append failure");
    },
  });
  journal.api.append({ type: "old" });
  await journal.api.flush();
  assert.deepEqual(journal.durable, []);
  assert.equal(journal.api.state().pending.length, 1);
  assert.deepEqual(eventTypes(journal.api.state().pending[0]), ["old"]);
  assert.match(journal.api.state().error, /transient append failure/);
  assert.equal(journal.warnings.length, 1);

  journal.api.append({ type: "new" });
  await journal.api.flush();
  assert.deepEqual(journal.attempts, ["old", "old", "new"]);
  assert.deepEqual(journal.durable, ["old", "new"]);
  assert.equal(journal.api.state().pending.length, 0);
  assert.equal(journal.api.state().bufferedBytes, 0);
  assert.equal(journal.api.state().error, null);
  assert.equal(journal.timers.size, 0);
});

test("concurrent flushes retain failed old evidence ahead of new evidence until every append is durable", async () => {
  const first = deferred();
  const last = deferred();
  const journal = createJournal({
    asyncAppend: (attempt) => {
      if (attempt === 1) return first.promise;
      if (attempt === 3) return last.promise;
    },
  });
  journal.api.append({ type: "old" });
  const oldFlush = journal.api.flush();
  // Advance the actual serialized write chain to its first append.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(journal.attempts, ["old"]);
  journal.api.append({ type: "new" });
  const newFlush = journal.api.flush();
  first.reject(new Error("test old append interrupted"));
  await oldFlush;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(journal.attempts, ["old", "old", "new"]);
  assert.deepEqual(journal.durable, ["old"]);
  assert.equal(journal.api.state().pending.length, 1);
  assert.deepEqual(eventTypes(journal.api.state().pending[0]), ["new"]);
  assert.match(journal.api.state().error, /old append interrupted/);

  last.resolve();
  await newFlush;
  assert.deepEqual(journal.durable, ["old", "new"]);
  assert.equal(journal.api.state().pending.length, 0);
  assert.equal(journal.api.state().error, null);
});

test("a synchronous append failure retains chunks and a synchronous retry clears the error", () => {
  const journal = createJournal({
    syncAppend: (attempt) => {
      if (attempt === 1) throw new Error("test transient sync append failure");
    },
  });
  journal.api.append({ type: "old" });
  journal.api.flushSync();
  assert.deepEqual(journal.durable, []);
  assert.equal(journal.api.state().pending.length, 1);
  assert.match(journal.api.state().error, /transient sync append failure/);
  assert.equal(journal.timers.size, 0);

  journal.api.append({ type: "new" });
  journal.api.flushSync();
  assert.deepEqual(journal.attempts, ["old", "old", "new"]);
  assert.deepEqual(journal.durable, ["old", "new"]);
  assert.equal(journal.api.state().pending.length, 0);
  assert.equal(journal.api.state().error, null);
  assert.equal(journal.timers.size, 0);
});

test("a failed asynchronous append can be recovered by the final synchronous drain", async () => {
  const journal = createJournal({ asyncAppend: () => { throw new Error("test async disk error"); } });
  journal.api.append({ type: "old" });
  await journal.api.flush();
  journal.api.append({ type: "new" });
  journal.api.flushSync();
  assert.deepEqual(journal.durable, ["old", "new"]);
  assert.equal(journal.api.state().pending.length, 0);
  assert.equal(journal.api.state().error, null);
});

test("empty flushes and empty scheduling perform no disk operations and start no timer", async () => {
  const journal = createJournal();
  journal.api.schedule();
  await journal.api.flush();
  journal.api.flushSync();
  assert.deepEqual(journal.calls, []);
  assert.deepEqual(journal.durable, []);
  assert.equal(journal.timers.size, 0);
  assert.equal(journal.api.state().error, null);

  journal.api.append({ type: "only" });
  await journal.api.flush();
  const previousCalls = journal.calls.length;
  journal.api.schedule();
  await journal.api.flush();
  journal.api.flushSync();
  assert.equal(journal.calls.length, previousCalls);
  assert.deepEqual(journal.durable, ["only"]);
});
