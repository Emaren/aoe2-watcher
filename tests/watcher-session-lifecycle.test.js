const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "watcher.js"), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

// Exercise the actual watcher startup/scan/admission functions with fake disk,
// filesystem watchers and timers. No application, upload or network is started.
function createHarness(options = {}) {
  const h = { files: ["control.aoe2record"], events: [], monitors: [], sleeps: [], intervals: [], watchers: [], missingFiles: new Set() };
  const fakeFs = {
    existsSync: (filePath) => !h.missingFiles.has(filePath),
    watch: (_directory, _options, callback) => {
      const watcher = { callback, closed: false, close() { this.closed = true; }, on() {} };
      h.watchers.push(watcher);
      return watcher;
    },
    promises: {
      readdir: async () => h.files.map((name) => ({ name, isFile: () => true })),
      stat: async () => ({ size: 200, mtimeMs: Date.now() }),
    },
  };
  const context = vm.createContext({
    Buffer, console, Promise,
    process: { env: {}, platform: "darwin" },
    module: { exports: {} },
    __dirname: root,
    setTimeout: (fn) => { h.sleeps.push(fn); return h.sleeps.length; },
    setInterval: (fn) => { h.intervals.push(fn); return h.intervals.length; },
    clearInterval: () => {},
    __h: h,
    __identityGate: options.identityGate,
    __realMonitor: options.realMonitor === true,
    require: (name) => {
      if (name === "fs") return fakeFs;
      if (name === "axios") return new Proxy({}, { get() { throw new Error("No network permitted"); } });
      if (name === "child_process") return { execFileSync() { throw new Error("No process permitted"); } };
      if (name === "form-data") return class {};
      if (name.startsWith("./")) return require(path.join(root, name));
      return require(name);
    },
  });
  vm.runInContext(`${source}\n
    inspectReplayFolder = () => ({ exists: true, isDirectory: true, readable: true, valid: true, supportedReplayCount: 0 });
    loadSettlementState = () => 0;
    resolveFinalReplayShortCircuit = async () => __identityGate ? await __identityGate.promise : null;
    if (!__realMonitor) monitorReplayFile = async (filePath, config, generation) => __h.monitors.push({ filePath, watchDir: config.watchDir, generation });
    globalThis.__test = {
      start: (watchDir) => module.exports.startWatching({ watchDir, uploadApiKey: "test-key", apiBaseUrl: "https://example.invalid" }, {
        onLog() {},
        onEvent(event) { __h.events.push({ ...event, runtime: module.exports.getRuntimeStatus() }); },
      }),
      stop: module.exports.stopWatching,
      status: module.exports.getRuntimeStatus,
      recoveryFlag: () => activeRecoveryScanInFlight,
      entry: (filePath) => getStateEntry(filePath),
    };
  `, context, { filename: path.join(root, "watcher.js") });
  h.api = context.__test;
  h.tick = async () => { for (let index = 0; index < 15; index += 1) await Promise.resolve(); };
  h.releaseSleep = async () => { assert.ok(h.sleeps.length); h.sleeps.shift()(); await h.tick(); };
  return h;
}

test("a stopped initial growth scan cannot admit a replay or start a stale monitor", async () => {
  const h = createHarness();
  h.api.start("/test/old");
  await h.tick();
  assert.equal(h.api.status().replayScanInFlight, true);
  assert.equal(h.sleeps.length, 1);
  h.api.stop();
  assert.equal(h.api.status().replayScanInFlight, false);
  await h.releaseSleep();
  assert.equal(h.monitors.length, 0);
  assert.equal(h.events.some((event) => event.type === "replay-detected"), false);
  assert.equal(h.watchers[0].closed, true);
});

test("restarting monitoring invalidates the old growth scan and old filesystem callbacks", async () => {
  const h = createHarness();
  h.api.start("/test/old");
  await h.tick();
  h.files = [];
  h.api.start("/test/new");
  await h.tick();
  h.watchers[0].callback("change", "stale.aoe2record");
  await h.releaseSleep();
  assert.equal(h.monitors.length, 0);
  assert.equal(h.api.status().replayScanInFlight, false);
  assert.equal(h.events.some((event) => event.type === "replay-detected"), false);
  h.api.stop();
});

test("current scan completion clears the scan blocker before emitting its idle-seam event", async () => {
  const h = createHarness();
  h.api.start("/test/current");
  await h.tick();
  assert.equal(h.api.status().replayScanInFlight, true);
  await h.releaseSleep();
  assert.equal(h.monitors.length, 1);
  assert.equal(h.monitors[0].watchDir, "/test/current");
  const completion = h.events.find((event) => event.type === "replay-scan-complete");
  assert.ok(completion);
  assert.equal(completion.runtime.replayScanInFlight, false);
  assert.equal(completion.runtime.activeReplay, true);
  h.api.stop();
});

test("an old recovery scanner cannot clear a new session's recovery-in-flight fence", async () => {
  const h = createHarness();
  h.files = [];
  h.api.start("/test/old");
  await h.tick();
  h.files = ["control.aoe2record"];
  h.intervals[0]();
  await h.tick();
  assert.equal(h.api.recoveryFlag(), true);
  h.files = [];
  h.api.start("/test/new");
  await h.tick();
  h.files = ["new.aoe2record"];
  h.intervals[1]();
  await h.tick();
  assert.equal(h.sleeps.length, 2);
  await h.releaseSleep();
  assert.equal(h.api.recoveryFlag(), true);
  assert.equal(h.api.status().replayScanInFlight, true);
  assert.equal(h.monitors.length, 0);
  await h.releaseSleep();
  assert.equal(h.api.recoveryFlag(), false);
  assert.equal(h.monitors.length, 1);
  assert.equal(h.monitors[0].watchDir, "/test/new");
  h.api.stop();
});

test("pending replay identity admission is busy and cannot resume into a stopped session", async () => {
  const gate = deferred();
  const h = createHarness({ identityGate: gate });
  h.files = [];
  h.api.start("/test/old");
  await h.tick();
  h.watchers[0].callback("change", "control.aoe2record");
  await h.tick();
  assert.equal(h.api.status().activeReplay, true);
  h.api.start("/test/new");
  await h.tick();
  assert.equal(h.api.status().activeReplay, false);
  gate.resolve(null);
  await h.tick();
  assert.equal(h.monitors.length, 0);
  assert.equal(h.api.status().activeReplay, false);
  h.api.stop();
});

test("stopped byte-floor monitors cannot emit stale progress or clear new ownership for the same replay", async () => {
  const h = createHarness({ realMonitor: true });
  h.files = [];
  h.api.start("/test/shared");
  await h.tick();
  h.watchers[0].callback("change", "control.aoe2record");
  await h.tick();
  const oldEntry = h.api.entry("/test/shared/control.aoe2record");
  assert.equal(oldEntry.monitoring, true);
  assert.equal(h.api.status().activeReplay, true);
  assert.equal(h.sleeps.length, 1);
  h.api.stop();
  assert.equal(h.api.status().activeReplay, false);

  h.api.start("/test/shared");
  await h.tick();
  h.watchers[1].callback("change", "control.aoe2record");
  await h.tick();
  const newEntry = h.api.entry("/test/shared/control.aoe2record");
  assert.notEqual(newEntry, oldEntry);
  assert.equal(newEntry.monitoring, true);
  const eventCount = h.events.length;
  await h.releaseSleep();
  assert.equal(oldEntry.monitoring, false);
  assert.equal(newEntry.monitoring, true);
  assert.equal(h.api.status().activeReplay, true);
  assert.equal(h.events.length, eventCount);
  assert.equal(h.events.some((event) => event.type === "upload-start"), false);
  h.api.stop();
  await h.releaseSleep();
  assert.equal(h.api.status().activeReplay, false);
});

test("one monitor completing cannot declare idle while another current replay monitor remains active", async () => {
  const h = createHarness({ realMonitor: true });
  h.files = [];
  h.api.start("/test/current");
  await h.tick();
  h.watchers[0].callback("change", "first.aoe2record");
  h.watchers[0].callback("change", "second.aoe2record");
  await h.tick();
  assert.equal(h.api.entry("/test/current/first.aoe2record").monitoring, true);
  assert.equal(h.api.entry("/test/current/second.aoe2record").monitoring, true);
  assert.equal(h.sleeps.length, 2);

  h.missingFiles.add("/test/current/first.aoe2record");
  await h.releaseSleep();
  assert.equal(h.api.entry("/test/current/first.aoe2record").monitoring, false);
  assert.equal(h.api.entry("/test/current/second.aoe2record").monitoring, true);
  assert.equal(h.api.status().activeReplay, true);
  const firstStop = h.events.find((event) => event.type === "monitor-stop" && event.fileName === "first.aoe2record");
  assert.equal(firstStop.runtime.activeReplay, true);

  h.missingFiles.add("/test/current/second.aoe2record");
  await h.releaseSleep();
  assert.equal(h.api.status().activeReplay, false);
  const finalStop = h.events.find((event) => event.type === "monitor-stop" && event.fileName === "second.aoe2record");
  assert.equal(finalStop.runtime.activeReplay, false);
  assert.equal(h.events.some((event) => event.type === "upload-start"), false);
  h.api.stop();
});
