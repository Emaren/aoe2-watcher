const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_FINAL_SETTLE_POLL_MS,
  DEFAULT_FOLDER_FRESHNESS_PROBE_MS,
  DEFAULT_FOLDER_STATUS_CACHE_MS,
  DEFAULT_IDLE_RECOVERY_SCAN_MS,
  DEFAULT_MONITOR_WATCHDOG_MS,
  DEFAULT_UPDATE_RECHECK_MS,
  getUpdateBlocker,
  getUpdateTrayPresentation,
  shouldLaunchInBackground,
  shouldRunBackgroundUpdateCheck,
} = require("../runtimePolicy");

const { boundedBackgroundIntervalMs } = require("../backgroundTimerPolicy");

test("armed but idle watcher does not block update install", () => {
  assert.equal(
    getUpdateBlocker({
      runtimeStatus: {
        monitorAttached: true,
        activeReplay: false,
        uploadQueueLength: 0,
      },
    }),
    null
  );
});

test("real replay work blocks update installation", () => {
  assert.equal(
    getUpdateBlocker({
      runtimeStatus: { activeReplay: true, uploadQueueLength: 0 },
    }),
    "active_replay"
  );
  assert.equal(
    getUpdateBlocker({
      runtimeStatus: { activeReplay: false, uploadQueueLength: 1 },
    }),
    "replay_upload"
  );
  assert.equal(
    getUpdateBlocker({ runtimeStatus: {}, importRunning: true }),
    "historical_import"
  );
  assert.equal(
    getUpdateBlocker({ runtimeStatus: {}, nativeStreamActive: true }),
    "native_stream"
  );
  assert.equal(
    getUpdateBlocker({ runtimeStatus: { replayScanInFlight: true } }),
    "replay_scan"
  );
});

test("background launch policy recognizes login and explicit starts", () => {
  assert.equal(shouldLaunchInBackground({ argv: ["watcher"] }), false);
  assert.equal(
    shouldLaunchInBackground({ argv: ["watcher", "--background"] }),
    true
  );
  assert.equal(
    shouldLaunchInBackground({
      argv: ["watcher"],
      wasOpenedAtLogin: true,
    }),
    true
  );
});

test("manual Mac update is visible and actionable from the tray", () => {
  assert.deepEqual(
    getUpdateTrayPresentation({
      status: "manual_required",
      manualInstall: true,
      updateVersion: "1.6.2",
      downloaded: false,
    }),
    {
      action: "download_manual",
      label: "Download Watcher 1.6.2",
      tooltip: "AoE2HDBets Watcher — update 1.6.2 available",
    }
  );
});

test("downloaded update remains an install action and idle state remains a check", () => {
  assert.equal(
    getUpdateTrayPresentation({
      downloaded: true,
    }).action,
    "install_downloaded"
  );
  assert.deepEqual(
    getUpdateTrayPresentation({}),
    {
      action: "check",
      label: "Check for Updates",
      tooltip: "AoE2HDBets Watcher",
    }
  );
});

test("background update polling runs only while no update is already pending", () => {
  assert.equal(
    shouldRunBackgroundUpdateCheck({
      status: "current",
    }),
    true
  );
  assert.equal(
    shouldRunBackgroundUpdateCheck({
      status: "error",
    }),
    true
  );

  for (const state of [
    { status: "checking" },
    { status: "downloading" },
    { status: "manual_required", manualInstall: true },
    { status: "pending_install", downloaded: true },
    { status: "installing" },
  ]) {
    assert.equal(
      shouldRunBackgroundUpdateCheck(state),
      false
    );
  }
});

test("idle safety nets are deliberately low-frequency", () => {
  assert.ok(DEFAULT_IDLE_RECOVERY_SCAN_MS >= 60_000);
  assert.ok(DEFAULT_MONITOR_WATCHDOG_MS >= 60_000);
  assert.ok(DEFAULT_FOLDER_FRESHNESS_PROBE_MS >= 300_000);
  assert.ok(DEFAULT_FOLDER_STATUS_CACHE_MS >= 300_000);
  assert.ok(DEFAULT_FINAL_SETTLE_POLL_MS >= 10_000);
  assert.ok(DEFAULT_UPDATE_RECHECK_MS >= 6 * 60 * 60 * 1000);
});


test("folder inspection reports bounded cost evidence for power audits", () => {
  const watcherSource = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "watcher.js"),
    "utf8"
  );

  assert.match(watcherSource, /entriesScanned/);
  assert.match(watcherSource, /inspectionDurationMs/);
  assert.match(watcherSource, /process\.hrtime\.bigint\(\)/);
});


test("malformed timing overrides never become Node's one-millisecond hot loop",()=>{
 const policy={fallback:60_000,minimum:5_000};
 for(const input of [undefined,null,""," ","NaN","Infinity","-Infinity",
   "unparsable",0,"0",-10,"-10",NaN,Infinity,-Infinity]) {
  assert.equal(boundedBackgroundIntervalMs(input,policy),60_000,String(input));
 }
 for(const input of ["0.1","1","2",1,0.01,4999,"4999"]) {
  assert.equal(boundedBackgroundIntervalMs(input,policy),5_000,String(input));
 }
 assert.equal(boundedBackgroundIntervalMs("5000",policy),5000);
 assert.equal(boundedBackgroundIntervalMs("12.9",policy),5000);
 assert.equal(boundedBackgroundIntervalMs("20000",policy),20000);
 assert.equal(boundedBackgroundIntervalMs("9000000000000000",policy),2_147_483_647);
 assert.equal(boundedBackgroundIntervalMs("2500",{fallback:2000,minimum:250,maximum:60000}),2500);
 assert.equal(boundedBackgroundIntervalMs("garbage",{fallback:2000,minimum:250,maximum:60000}),2000);
 assert.equal(boundedBackgroundIntervalMs("3",{fallback:2000,minimum:250,maximum:60000}),250);
 assert.throws(()=>boundedBackgroundIntervalMs("5000",{fallback:0,minimum:5}),/invalid background timer policy/);
 assert.throws(()=>boundedBackgroundIntervalMs("5000",{fallback:5000,minimum:10000}),/invalid background timer policy/);
});

test("Electron main background and journal intervals are all read through the bounded policy",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const code=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
 for(const name of [
  "RUNTIME_EVENT_JOURNAL_FLUSH_MS","MONITOR_WATCHDOG_MS","UPDATE_RECHECK_MS",
  "REPLAY_FOLDER_FRESHNESS_PROBE_MS","FOLDER_STATUS_CACHE_MS",
  "MONITOR_REATTACH_COOLDOWN_MS","RESOURCE_SAMPLE_MS","RESOURCE_IDLE_SAMPLE_MS"
 ]) {
  assert.match(code,new RegExp("const "+name+" = boundedBackgroundIntervalMs\\("));
 }
 assert.match(code,/const MONITOR_REATTACH_LIMIT = \(\(\) =>/);
 assert.match(code,/Number\.isSafeInteger\(value\) && value > 0/);
});
