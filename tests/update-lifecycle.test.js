const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "main.js"), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// The actual main process source runs in an isolated context. Electron, disk,
// network, timers, and user configuration are fakes; no application is opened.
function createHarness(options = {}) {
  const calls = [];
  const runtime = { activeReplay: false, uploadQueueLength: 0 };
  const config = {
    watcherId: "test-watcher",
    watchDir: "/test/replays",
    uploadApiKey: "test-key",
    apiBaseUrl: "https://example.invalid",
    apiFallbackBaseUrl: "https://example.invalid",
  };
  const timers = new Map();
  let timerId = 0;
  const record = (name, ...args) => calls.push({ name, args });
  const schedule = (kind, fn, delay) => {
    const id = ++timerId;
    timers.set(id, { kind, fn, delay });
    return id;
  };

  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: options.packaged !== false,
    isReady: () => false,
    getAppMetrics: () => [],
    getPath: () => "/test/user-data",
    getAppPath: () => "/test/Watcher.app/Contents/Resources/app.asar",
    getName: () => "AoE2HDBets Watcher",
    getVersion: () => "1.6.3",
    requestSingleInstanceLock: () => {
      record("single-instance-lock");
      return options.lock !== false;
    },
    whenReady: () => {
      record("when-ready");
      return new Promise(() => {});
    },
    quit: () => record("app-quit"),
    exit: (...args) => record("app-exit", ...args),
    relaunch: (...args) => record("app-relaunch", ...args),
  });

  const updater = new EventEmitter();
  updater.setFeedURL = (...args) => record("updater-feed", ...args);
  updater.isUpdateSupported = (info) => {
    record("upstream-supported", info);
    return options.upstreamSupported !== false;
  };
  updater.checkForUpdates = async () => {
    record("updater-check");
    return { updateInfo: { version: "1.6.4" } };
  };
  let installerCalled = false;
  updater.quitAndInstall = (...args) => {
    record("quit-and-install", ...args);
    if (options.asyncInstallerError) {
      // BaseUpdater's requested installation is latched even when its async
      // installer fails; a second public void call silently does nothing.
      if (installerCalled) {
        record("installer-noop");
        return;
      }
      installerCalled = true;
      record("installer-start");
      queueMicrotask(() => updater.emit("error", options.asyncInstallerError));
      return;
    }
    if (options.installError) throw options.installError;
  };
  const nativeUpdater = new EventEmitter();
  let nativeFeedURL = "http://127.0.0.1:43210";
  nativeUpdater.getFeedURL = () => nativeFeedURL;
  nativeUpdater.checkForUpdates = () => record("native-updater-check");
  nativeUpdater.setFeedURL = (...args) => record("native-updater-feed", ...args);
  nativeUpdater.quitAndInstall = (...args) => record("native-quit-and-install", ...args);

  const forbidden = (name) => (...args) => {
    record(name, ...args);
    throw new Error(`Unexpected external operation: ${name}`);
  };
  const fakeFs = new Proxy({}, {
    get: (_target, key) => {
      if (key === "existsSync") return () => false;
      if (key === "promises") {
        return new Proxy({}, { get: (_value, method) => forbidden(`fs.${method}`) });
      }
      return forbidden(`fs.${key}`);
    },
  });
  const axios = (request) => {
    if (!options.network) return forbidden("network")(request);
    record("network", request);
    return options.network(request);
  };
  axios.get = forbidden("network-get");
  axios.post = (url, data, extra) => axios({ url, data, ...extra });
  const watcher = {
    getRuntimeStatus: () => runtime,
    stopWatching: () => record("watcher-stop", context.__test.streamRequests()),
    startWatching: () => {
      record("watcher-start");
      return { testHandle: true };
    },
    importHistoricalReplays: async () => {
      record("historical-import");
      return { isRunning: false, summaryText: "Test import complete" };
    },
    getDefaultReplayDir: () => "/test/replays",
    detectReplayFolder: () => "/test/replays",
    inspectReplayFolder: () => ({ valid: true, supportedReplayCount: 0 }),
    getSupportedReplayExtensions: () => [".aoe2record"],
    shouldSwitchReplayFolder: () => false,
  };
  const policy = require("../updatePolicy");
  const electron = {
    app,
    autoUpdater: nativeUpdater,
    BrowserWindow: class {
      constructor() {
        throw new Error("Harness must never launch a BrowserWindow");
      }
    },
    Tray: class {
      constructor() {
        throw new Error("Harness must never create a native tray");
      }
    },
    ipcMain: { handle: () => {}, on: () => {} },
    powerMonitor: new EventEmitter(),
    shell: { openExternal: forbidden("open-external") },
    Menu: { buildFromTemplate: (value) => value },
  };
  const h = {
    config,
    calls,
    record,
    flushAsync: async () => {
      record("journal-async");
      if (options.flushGate) await options.flushGate.promise;
      if (options.flushError) throw options.flushError;
    },
    flushSync: () => {
      record("journal-sync");
      if (options.flushSyncError) throw options.flushSyncError;
    },
  };
  const context = vm.createContext({
    console,
    Buffer,
    AbortController,
    URL,
    Promise,
    __dirname: root,
    __filename: path.join(root, "main.js"),
    process: {
      platform: options.platform || "win32",
      arch: "x64",
      pid: 424242,
      execPath: "/test/Watcher.app/Contents/MacOS/AoE2HDBets Watcher",
      argv: ["watcher"],
      versions: { node: process.versions.node, electron: "43.7.2" },
      env: {
        ...(options.platform === "linux" && options.appImage ? { APPIMAGE: "/test/Watcher.AppImage" } : {}),
        ...(options.portable ? { PORTABLE_EXECUTABLE_FILE: "C:\\test\\Watcher.exe" } : {}),
        ...(options.macAllowed ? { AOE2_ENABLE_MAC_AUTO_UPDATE: "1" } : {}),
      },
    },
    setTimeout: (fn, delay) => schedule("timeout", fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule("interval", fn, delay),
    clearInterval: (id) => timers.delete(id),
    __h: h,
    require: (name) => {
      if (name === "electron") return electron;
      if (name === "electron-updater") return { autoUpdater: updater };
      if (name === "dotenv") return { config: () => {} };
      if (name === "fs") return fakeFs;
      if (name === "axios") return axios;
      if (name === "./watcher") return watcher;
      if (name === "./updatePolicy") {
        return {
          ...policy,
          verifyMacUpdateIdentity: () => ({
            verified: options.macVerified === true,
            reason: options.macVerified ? null : "test_identity_unverified",
          }),
        };
      }
      if (name.startsWith("./")) return require(path.join(root, name));
      if (["path", "crypto", "os"].includes(name)) return require(name);
      if (name === "child_process") return { spawnSync: forbidden("spawn") };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  vm.runInContext(`${source}\n
    // Hooks replace effects only. Production lifecycle/admission functions above
    // remain the functions under test, including event handlers and app locking.
    loadConfig = () => __h.config;
    sendToRenderer = () => {};
    getAppInfo = () => ({});
    refreshTrayMenu = () => {};
    appendLog = (message) => __h.record("log", message);
    appendSessionHeader = () => {};
    clearRendererLog = () => {};
    emitUpdateTelemetry = (event) => __h.record("telemetry", event);
    emitWatcherTelemetry = (event) => __h.record("telemetry", event);
    clearStreamHandoffState = () => {};
    setWatchingState = () => {};
    verifyWatcherAuth = async () => {};
    flushRuntimeEventJournal = () => __h.flushAsync();
    flushRuntimeEventJournalSync = () => __h.flushSync();
    stopMonitorWatchdog = () => __h.record("watchdog-stop");
    startMonitorWatchdog = () => __h.record("watchdog-start");
    stopTelemetryHeartbeat = () => __h.record("heartbeat-stop");
    startTelemetryHeartbeat = () => __h.record("heartbeat-start");
    stopBackgroundUpdateChecks = () => __h.record("update-poll-stop");
    startBackgroundUpdateChecks = () => __h.record("update-poll-start");
    stopResourceProfiling = () => __h.record("resource-stop");
    startResourceProfiling = () => __h.record("resource-start");
    buildRuntimeMetadata = () => ({});
    refreshWatcherRelease = async () => ({
      updateAvailable: true, latestVersion: "1.6.4",
      updateUrl: "https://example.invalid/Watcher.zip"
    });
    globalThis.__test = {
      configure: configureAutoUpdater,
      install: installDownloadedWatcherUpdate,
      pending: maybeInstallPendingWatcherUpdate,
      check: checkForWatcherUpdates,
      start: startCurrentWatcher,
      import: runHistoricalImport,
      stream: postStreamJson,
      chunk: postStreamChunk,
      streamRequests: () => nativeStreamRequestsInFlight,
      state: () => JSON.parse(JSON.stringify(updateState)),
      setState: (patch) => { updateState = { ...updateState, ...patch }; },
      setJournalError: (error) => { runtimeJournalLastError = error; },
      setWork: (patch) => {
        if (patch.importRunning !== undefined) currentImportState.isRunning = patch.importRunning;
        if (patch.nativeStreamActive !== undefined) nativeStreamActive = patch.nativeStreamActive;
        if (patch.streamRequests !== undefined) nativeStreamRequestsInFlight = patch.streamRequests;
      },
      setWatcher: (enabled) => {
        watcherHandle = enabled ? { testHandle: true } : null;
        runtimeInitialized = enabled;
      },
      watcher: () => Boolean(watcherHandle),
      handoff: () => typeof updateHandoffActive !== "undefined" && updateHandoffActive,
      installPromise: () => typeof updateInstallPromise === "undefined" ? null : updateInstallPromise,
    };
  `, context, { filename: path.join(root, "main.js") });

  return {
    api: context.__test,
    config,
    calls,
    runtime,
    app,
    updater,
    nativeUpdater,
    setNativeFeedURL: (value) => { nativeFeedURL = value; },
    count: (name) => calls.filter((call) => call.name === name).length,
    event: async (name, info = { version: "1.6.4" }) => {
      updater.emit(name, info);
      await Promise.resolve();
    },
    fireInstallTimer: async () => {
      for (const [id, timer] of timers) {
        if (timer.kind === "timeout" && timer.delay === 700) {
          timers.delete(id);
          await timer.fn();
        }
      }
      await Promise.resolve();
      if (context.__test.installPromise()) await context.__test.installPromise();
    },
  };
}

function assertNoWorkInterrupted(h) {
  assert.equal(h.count("watcher-stop"), 0);
  assert.equal(h.count("quit-and-install"), 0);
  assert.equal(h.count("native-quit-and-install"), 0);
  assert.equal(h.count("heartbeat-stop"), 0);
  assert.equal(h.count("watchdog-stop"), 0);
}

function markDownloaded(h) {
  h.api.setState({ status: "downloaded", downloaded: true, updateVersion: "1.6.4" });
}

test("a second application instance exits before runtime or renderer initialization", () => {
  const h = createHarness({ lock: false });
  assert.equal(h.count("single-instance-lock"), 1);
  assert.equal(h.count("app-quit"), 1);
  assert.equal(h.count("when-ready"), 0);
  assert.equal(h.count("watcher-start"), 0);
  assert.equal(h.count("updater-check"), 0);
});

test("the winning application lock registers one runtime and one second-instance handler", () => {
  const h = createHarness();
  assert.equal(h.count("single-instance-lock"), 1);
  assert.equal(h.count("when-ready"), 1);
  assert.equal(h.app.listenerCount("second-instance"), 1);
  assert.equal(h.count("app-quit"), 0);
});

for (const family of ["active_replay", "replay_upload", "historical_import", "native_stream", "native_stream_request"]) {
  test(`downloaded update defers without stopping ${family}, then installs at idle`, async () => {
    const h = createHarness();
    h.api.setWatcher(true);
    if (family === "active_replay") h.runtime.activeReplay = true;
    if (family === "replay_upload") h.runtime.uploadQueueLength = 1;
    if (family === "historical_import") h.api.setWork({ importRunning: true });
    if (family === "native_stream") h.api.setWork({ nativeStreamActive: true });
    if (family === "native_stream_request") h.api.setWork({ streamRequests: 1 });
    h.api.configure();
    await h.event("update-downloaded");
    assert.equal(h.api.state().status, "pending_install");
    assert.equal(h.api.state().downloaded, true);
    assertNoWorkInterrupted(h);
    assert.equal(h.updater.autoInstallOnAppQuit, false);

    h.runtime.activeReplay = false;
    h.runtime.uploadQueueLength = 0;
    h.api.setWork({ importRunning: false, nativeStreamActive: false, streamRequests: 0 });
    h.api.pending("test_idle");
    await h.api.installPromise();
    assert.equal(h.count("quit-and-install"), 1);
    assert.deepEqual(h.calls.find((call) => call.name === "quit-and-install").args, [false, true]);
    assert.equal(h.count("watcher-stop"), 1);
  });
}

test("idle download installs once despite a concurrent manual request and pending callback", async () => {
  const gate = deferred();
  const h = createHarness({ flushGate: gate });
  h.api.setWatcher(true);
  h.api.configure();
  await h.event("update-downloaded");
  const first = h.api.install();
  const second = h.api.install();
  h.api.pending("duplicate_idle");
  await Promise.resolve();
  assert.equal(h.api.handoff(), true);
  assert.equal(h.count("watcher-stop"), 1);
  gate.resolve();
  await Promise.all([first, second]);
  await h.fireInstallTimer();
  assert.equal(h.count("quit-and-install"), 1);
});

test("journal drain fences import, new monitoring and stream admission before updater handoff", async () => {
  const gate = deferred();
  const h = createHarness({ flushGate: gate });
  h.api.setWatcher(true);
  markDownloaded(h);
  const installation = h.api.install();
  await Promise.resolve();
  assert.equal(h.api.handoff(), true);
  const imported = await h.api.import({ source: "batch" });
  assert.equal(imported.ok, false);
  assert.equal(h.api.start({ ...h.config }), false);
  await assert.rejects(h.api.stream({ path: "/api/streams/start" }), /updat|install/i);
  assert.equal(h.count("historical-import"), 0);
  assert.equal(h.count("watcher-start"), 0);
  assert.equal(h.count("network"), 0);
  gate.resolve();
  await installation;
  assert.equal(h.count("quit-and-install"), 1);
});

test("updater handoff follows watcher stop and both journal drains with relaunch requested", async () => {
  const h = createHarness();
  h.api.setWatcher(true);
  markDownloaded(h);
  await h.api.install();
  const names = h.calls.map((call) => call.name);
  assert.ok(names.indexOf("journal-async") > names.indexOf("watcher-stop"));
  assert.ok(names.indexOf("journal-sync") > names.indexOf("journal-async"));
  assert.ok(names.indexOf("quit-and-install") > names.indexOf("journal-sync"));
  assert.deepEqual(h.calls.find((call) => call.name === "quit-and-install").args, [false, true]);
  assert.equal(h.updater.autoRunAppAfterInstall, true);
  const prevented = [];
  h.app.emit("before-quit", { preventDefault: () => prevented.push(true) });
  assert.equal(prevented.length, 0);
});

for (const failure of ["flushError", "flushSyncError", "installError"]) {
  test(`${failure} restores monitoring and timers instead of leaving the watcher stopped`, async () => {
    const h = createHarness({ [failure]: new Error(`test ${failure}`) });
    h.api.setWatcher(true);
    markDownloaded(h);
    const result = await h.api.install();
    assert.equal(result.ok, false);
    assert.equal(h.api.handoff(), false);
    assert.equal(h.api.watcher(), true);
    assert.equal(h.api.state().downloaded, failure !== "installError");
    if (failure === "installError") {
      assert.equal(h.api.state().manualInstall, true);
      assert.equal(h.api.state().manualReason, "installer_handoff_failed");
      assert.equal(h.updater.autoDownload, false);
    } else {
      assert.equal(h.api.state().status, "error");
      assert.equal(h.api.state().manualInstall, false);
    }
    assert.match(h.api.state().error, /test/);
    assert.equal(h.count("watcher-start"), 1);
    assert.equal(h.count("watchdog-start"), 1);
    assert.equal(h.count("heartbeat-start"), 1);
    assert.equal(h.count("update-poll-start"), 1);
    assert.equal(h.count("app-quit"), 0);
  });
}

test("a delayed updater error restores the paused runtime after quitAndInstall handoff", async () => {
  const h = createHarness();
  h.api.setWatcher(true);
  markDownloaded(h);
  await h.api.install();
  await h.event("error", new Error("test installer failure"));
  assert.equal(h.api.handoff(), false);
  assert.equal(h.api.watcher(), true);
  assert.equal(h.count("watcher-start"), 1);
  assert.equal(h.api.state().downloaded, false);
  assert.equal(h.api.state().manualInstall, true);
  assert.equal(h.api.state().manualReason, "installer_handoff_failed");
});

test("failed installer handoff vetoes its stale queued quit once and permits a later manual exit", async () => {
  const h = createHarness();
  h.api.setWatcher(true);
  markDownloaded(h);
  await h.api.install();
  await h.event("error", new Error("test installer failure"));
  const stopped = h.count("watcher-stop");
  const timerStops = h.count("heartbeat-stop");
  let stalePrevented = false;
  h.app.emit("before-quit", { preventDefault: () => { stalePrevented = true; } });
  assert.equal(stalePrevented, true);
  assert.equal(h.api.watcher(), true);
  assert.equal(h.count("watcher-stop"), stopped);
  assert.equal(h.count("heartbeat-stop"), timerStops);

  // The next explicit quit may use the normal asynchronous journal drain.
  // It must not remain trapped behind the failed install's recovery veto.
  h.app.emit("before-quit", { preventDefault: () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.count("app-quit"), 1);
  let finalPrevented = false;
  h.app.emit("before-quit", { preventDefault: () => { finalPrevented = true; } });
  assert.equal(finalPrevented, false);
  assert.equal(h.api.watcher(), false);
});

test("a recorded journal persistence error blocks activation even when the drain resolves", async () => {
  const h = createHarness();
  h.api.setWatcher(true);
  h.api.setJournalError(new Error("test journal persistence failure"));
  markDownloaded(h);
  const result = await h.api.install();
  assert.equal(result.ok, false);
  assert.match(result.error, /test journal persistence failure/);
  assert.equal(h.api.handoff(), false);
  assert.equal(h.api.watcher(), true);
  assert.equal(h.count("watcher-start"), 1);
  assert.equal(h.count("quit-and-install"), 0);
  assert.equal(h.api.state().downloaded, true);
});

test("manual recheck cannot replace a downloaded deferred update with checking state", async () => {
  const h = createHarness();
  h.runtime.activeReplay = true;
  h.api.configure();
  await h.event("update-downloaded");
  await h.api.check({ manual: true });
  assert.equal(h.api.state().status, "pending_install");
  assert.equal(h.api.state().downloaded, true);
  assert.equal(h.count("updater-check"), 0);
});

test("normal quit cannot invoke the updater while a downloaded update has active work", async () => {
  const h = createHarness();
  h.runtime.activeReplay = true;
  h.api.configure();
  await h.event("update-downloaded");
  let prevented = false;
  h.app.emit("before-quit", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assertNoWorkInterrupted(h);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
});

test("unsigned macOS retains a manual replacement path even when auto-update is requested", async () => {
  const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: false });
  h.api.configure();
  await h.api.check({ manual: true });
  assert.equal(h.api.state().manualInstall, true);
  assert.equal(h.updater.autoDownload, false);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal(h.count("updater-check"), 0);
  assert.equal(h.count("quit-and-install"), 0);
  assert.equal(h.count("native-updater-check"), 0);
});

test("signed allowed macOS waits for native updater staging before any quit", async () => {
  const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
  h.api.setWatcher(true);
  h.api.configure();
  await h.event("update-downloaded");
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal(h.count("native-updater-check"), 1);
  await h.fireInstallTimer();
  assert.equal(h.count("quit-and-install"), 0);
  assert.equal(h.count("watcher-stop"), 0);

  // Squirrel's feed exposes only the ZIP URL, so no release-name/version
  // argument is manufactured to grant native staging readiness.
  h.nativeUpdater.emit("update-downloaded", {}, "", "", new Date(0), "http://127.0.0.1:43210/update.zip");
  await Promise.resolve();
  await h.fireInstallTimer();
  if (h.api.installPromise()) await h.api.installPromise();
  assert.equal(h.count("quit-and-install"), 1);
  assert.deepEqual(h.calls.find((call) => call.name === "quit-and-install").args, [false, true]);
});

for (const options of [{ platform: "linux" }, { platform: "win32", portable: true }]) {
  test(`${options.platform} unsupported packaging stays manual and never runs an installer`, async () => {
    const h = createHarness(options);
    h.api.configure();
    await h.api.check({ manual: true });
    assert.equal(h.api.state().manualInstall, true);
    assert.equal(h.updater.autoDownload, false);
    assert.equal(h.updater.autoInstallOnAppQuit, false);
    assert.equal(h.count("updater-check"), 0);
    assert.equal(h.count("quit-and-install"), 0);
  });
}

test("upstream support and stable-channel validation both govern available updates", () => {
  const h = createHarness();
  h.api.configure();
  assert.equal(h.updater.allowDowngrade, false);
  assert.equal(h.updater.allowPrerelease, false);
  assert.equal(h.updater.isUpdateSupported({ version: "1.6.4-beta.1" }), false);
  assert.equal(h.updater.isUpdateSupported({ version: "1.6.2" }), false);
  assert.equal(h.updater.isUpdateSupported({ version: "1.6.4" }), true);
  assert.ok(h.count("upstream-supported") > 0);
  const unsupported = createHarness({ upstreamSupported: false });
  unsupported.api.configure();
  assert.equal(unsupported.updater.isUpdateSupported({ version: "1.6.4" }), false);
});

test("real stream start and end requests defer installation until the final request completes", async () => {
  const startGate = deferred();
  const endGate = deferred();
  const h = createHarness({
    network: (request) => request.url.endsWith("/start") ? startGate.promise : endGate.promise,
  });
  h.api.setWatcher(true);
  h.api.configure();
  const started = h.api.stream({ path: "/api/streams/start" });
  assert.equal(h.api.streamRequests(), 1);
  await h.event("update-downloaded");
  assert.equal(h.api.state().status, "pending_install");
  assertNoWorkInterrupted(h);
  startGate.resolve({ status: 200, data: { stream: { id: 1 } } });
  await started;
  assert.equal(h.api.streamRequests(), 0);
  assertNoWorkInterrupted(h);

  const ended = h.api.stream({ path: "/api/streams/1/end" });
  assert.equal(h.api.streamRequests(), 1);
  assertNoWorkInterrupted(h);
  endGate.resolve({ status: 200, data: {} });
  await ended;
  if (h.api.installPromise()) await h.api.installPromise();
  assert.equal(h.api.streamRequests(), 0);
  assert.equal(h.count("quit-and-install"), 1);
  assert.equal(h.calls.find((call) => call.name === "watcher-stop").args[0], 0);
});

test("a queued media chunk defers installation and releases its request fence on failure", async () => {
  const gate = deferred();
  const h = createHarness({ network: () => gate.promise });
  h.api.setWatcher(true);
  h.api.configure();
  const uploaded = h.api.chunk({ streamId: 1, sequence: 0, bytes: Buffer.from("test-media") });
  assert.equal(h.api.streamRequests(), 1);
  await h.event("update-downloaded");
  assert.equal(h.api.state().status, "pending_install");
  assertNoWorkInterrupted(h);
  const rejected = assert.rejects(uploaded, /test upload failure/);
  gate.reject(new Error("test upload failure"));
  await rejected;
  if (h.api.installPromise()) await h.api.installPromise();
  assert.equal(h.api.streamRequests(), 0);
  assert.equal(h.count("quit-and-install"), 1);
  assert.equal(h.calls.find((call) => call.name === "watcher-stop").args[0], 0);
});

test("version events preserve the supported download and deferred-install sequence", async () => {
  const h = createHarness();
  h.api.configure();
  await h.event("checking-for-update");
  assert.equal(h.api.state().status, "checking");
  await h.event("update-available");
  assert.equal(h.api.state().status, "available");
  assert.equal(h.api.state().updateVersion, "1.6.4");
  await h.event("download-progress", { percent: 57 });
  assert.equal(h.api.state().status, "downloading");
  assert.equal(h.api.state().downloadPercent, 57);
  h.runtime.activeReplay = true;
  await h.event("update-downloaded");
  assert.equal(h.api.state().status, "pending_install");
  assert.equal(h.api.state().downloadPercent, 100);
  assert.equal(h.api.state().downloaded, true);
  assertNoWorkInterrupted(h);
});

test("stale and prerelease download events cannot enter the install lane", async () => {
  const h = createHarness();
  h.api.configure();
  for (const version of ["1.6.2", "1.6.3", "1.6.4-beta.1", "invalid"]) {
    await h.event("update-available", { version });
    await h.event("update-downloaded", { version });
    assert.equal(h.api.state().downloaded, false);
  }
  await h.fireInstallTimer();
  assertNoWorkInterrupted(h);
});

for (const [kind, url] of [
  ["missing URL", undefined],
  ["wrong origin", "http://127.0.0.1:43211/update.zip"],
  ["non-ZIP artifact", "http://127.0.0.1:43210/update.exe"],
]) {
  test(`macOS staging cannot accept a native update event with ${kind}`, async () => {
    const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
    h.api.setWatcher(true);
    h.api.configure();
    await h.event("update-downloaded");
    h.nativeUpdater.emit("update-downloaded", {}, "", "", new Date(0), url);
    await Promise.resolve();
    await h.fireInstallTimer();
    assertNoWorkInterrupted(h);
    assert.equal(h.updater.autoInstallOnAppQuit, false);
    assert.equal(h.count("native-updater-check"), 1);
  });
}

test("macOS staging rejects readiness if the public native feed changes", async () => {
  const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
  h.api.setWatcher(true);
  h.api.configure();
  await h.event("update-downloaded");
  h.setNativeFeedURL("http://127.0.0.1:43211");
  h.nativeUpdater.emit("update-downloaded", {}, "", "", new Date(0), "http://127.0.0.1:43210/update.zip");
  await Promise.resolve();
  await h.fireInstallTimer();
  assertNoWorkInterrupted(h);
});

test("macOS staging rejects native readiness for a different outer candidate version", async () => {
  const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
  h.api.setWatcher(true);
  h.api.configure();
  await h.event("update-downloaded");
  h.api.setState({ updateVersion: "1.6.5" });
  h.nativeUpdater.emit("update-downloaded", {}, "", "", new Date(0), "http://127.0.0.1:43210/update.zip");
  await Promise.resolve();
  await h.fireInstallTimer();
  assertNoWorkInterrupted(h);
});

test("duplicate macOS wrapper download events do not stage the native updater twice", async () => {
  const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
  h.api.configure();
  await h.event("update-downloaded");
  await h.event("update-downloaded");
  assert.equal(h.count("native-updater-check"), 1);
  assert.equal(h.count("quit-and-install"), 0);
});

test("failed macOS staging remains manual for the process and ignores late readiness", async () => {
  const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
  h.api.setWatcher(true);
  h.api.configure();
  await h.event("update-downloaded");
  await h.event("error", new Error("test native staging failure"));
  assert.equal(h.api.state().manualInstall, true);
  assert.equal(h.api.state().downloaded, false);
  assert.equal(h.updater.autoDownload, false);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  h.nativeUpdater.emit("update-downloaded", {}, "", "", new Date(0), "http://127.0.0.1:43210/update.zip");
  await Promise.resolve();
  await h.fireInstallTimer();
  await h.api.install();
  await h.api.check({ manual: true });
  await h.event("update-downloaded", { version: "1.6.5" });
  assertNoWorkInterrupted(h);
  assert.equal(h.count("native-updater-check"), 1);
  assert.equal(h.api.state().manualInstall, true);
  assert.equal(h.api.state().downloaded, false);
});

test("an updater error revokes an in-progress journal drain before any quit handoff", async () => {
  const gate = deferred();
  // No monitoring handle is present: the revoked-handoff guard must stand on
  // its own rather than relying on monitoring recovery to create new work.
  const h = createHarness({ flushGate: gate });
  markDownloaded(h);
  const installation = h.api.install();
  await Promise.resolve();
  assert.equal(h.api.handoff(), true);
  await h.event("error", new Error("test handoff revoked during drain"));
  assert.equal(h.api.handoff(), false);
  gate.resolve();
  const result = await installation;
  assert.equal(result.ok, false);
  assert.equal(h.count("journal-sync"), 0);
  assert.equal(h.count("quit-and-install"), 0);
  assert.equal(h.count("app-quit"), 0);
});

for (const feed of ["", "not-a-native-feed-url"]) {
  test(`macOS staging fails closed before native checks when its public feed is ${feed ? "invalid" : "missing"}`, async () => {
    const h = createHarness({ platform: "darwin", macAllowed: true, macVerified: true });
    h.api.setWatcher(true);
    h.setNativeFeedURL(feed);
    h.api.configure();
    await h.event("update-downloaded");
    assert.equal(h.api.state().manualInstall, true);
    assert.equal(h.api.state().downloaded, false);
    assert.equal(h.updater.autoDownload, false);
    assert.equal(h.count("native-updater-check"), 0);
    assertNoWorkInterrupted(h);
  });
}

test("a latched asynchronous installer failure requires manual recovery instead of a silent second handoff", async () => {
  const h = createHarness({ asyncInstallerError: new Error("test async installer failed") });
  h.api.setWatcher(true);
  markDownloaded(h);
  await h.api.install();
  await Promise.resolve();
  assert.equal(h.api.handoff(), false);
  assert.equal(h.api.watcher(), true);
  assert.equal(h.api.state().manualInstall, true);
  assert.equal(h.api.state().manualReason, "installer_handoff_failed");
  assert.equal(h.api.state().downloaded, false);
  assert.equal(h.updater.autoDownload, false);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  const stops = h.count("watcher-stop");
  const retried = await h.api.install();
  assert.equal(retried.ok, false);
  assert.equal(retried.manualRequired, true);
  h.api.pending("late_idle");
  await h.api.check({ manual: true });
  await h.event("update-downloaded", { version: "1.6.5" });
  assert.equal(h.api.state().manualInstall, true);
  assert.equal(h.api.state().downloaded, false);
  assert.equal(h.count("quit-and-install"), 1);
  assert.equal(h.count("installer-start"), 1);
  assert.equal(h.count("installer-noop"), 0);
  assert.equal(h.count("watcher-stop"), stops);
  assert.equal(h.api.watcher(), true);
});

test("a transient journal error before installer handoff permits a safe same-process retry", async () => {
  const options = { flushError: new Error("test transient journal preparation failure") };
  const h = createHarness(options);
  h.api.setWatcher(true);
  markDownloaded(h);
  const first = await h.api.install();
  assert.equal(first.ok, false);
  assert.equal(h.api.state().downloaded, true);
  assert.equal(h.api.state().manualInstall, false);
  assert.equal(h.api.watcher(), true);
  assert.equal(h.count("quit-and-install"), 0);
  delete options.flushError;
  const retried = await h.api.install();
  assert.equal(retried.ok, true);
  assert.equal(retried.installing, true);
  assert.equal(h.count("quit-and-install"), 1);
});
