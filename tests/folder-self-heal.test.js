const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource =
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "main.js"
    ),
    "utf8"
  );

function extractTelemetryCall(
  source,
  eventName
) {
  const eventIndex =
    source.indexOf(
      `"${eventName}"`
    );

  assert.ok(
    eventIndex >= 0,
    `${eventName} must exist`
  );

  const start =
    source.lastIndexOf(
      "emitWatcherTelemetry(",
      eventIndex
    );

  assert.ok(
    start >= 0,
    `${eventName} telemetry call must have a start`
  );

  const tail =
    source.slice(start);

  const endMatch =
    tail.match(
      /\n\s*\);\n/
    );

  assert.ok(
    endMatch,
    `${eventName} telemetry call must have an end`
  );

  return tail.slice(
    0,
    endMatch.index +
      endMatch[0].length
  );
}

test(
  "Watcher repairs a stale replay folder at startup, pairing, and watchdog recovery",
  () => {
    assert.match(
      mainSource,
      /function recoverReplayFolderConfig\(/
    );

    assert.match(
      mainSource,
      /const detectedFolder =\s*detectReplayFolder\(\)/
    );

    assert.match(
      mainSource,
      /watch_folder_auto_repair_started/
    );

    assert.match(
      mainSource,
      /watch_folder_auto_repaired/
    );

    assert.match(
      mainSource,
      /watch_folder_auto_repair_failed/
    );

    assert.match(
      mainSource,
      /source: "startup"/
    );

    assert.match(
      mainSource,
      /source: "pairing"/
    );

    assert.match(
      mainSource,
      /safelyReattachMonitor\(\s*"watchdog_folder_unavailable"\s*\)/
    );
  }
);

test(
  "Watcher self-heal telemetry keeps the recovered absolute path local",
  () => {
    const helper =
      mainSource.match(
        /function recoverReplayFolderConfig\([\s\S]*?function applyLaunchAtLogin/
      )?.[0] || "";

    assert.ok(
      helper.length > 0,
      "self-heal helper must exist"
    );

    const events = [
      "watch_folder_auto_repair_failed",
      "watch_folder_auto_repair_started",
      "watch_folder_auto_repaired",
    ];

    for (const eventName of events) {
      const telemetry =
        extractTelemetryCall(
          helper,
          eventName
        );

      assert.doesNotMatch(
        telemetry,
        /detectedFolder\.path/,
        `${eventName} must not transmit detected absolute path`
      );

      assert.doesNotMatch(
        telemetry,
        /currentFolder\.error/,
        `${eventName} must not transmit raw filesystem errors`
      );
    }

    assert.doesNotMatch(
      helper,
      /previousFolderError/
    );

    assert.match(
      helper,
      /previousFolderProblem/
    );

    assert.match(
      helper,
      /saveConfig\(\{[\s\S]*?watchDir:\s*detectedFolder\.path/,
      "recovered absolute path must still be persisted locally"
    );
  }
);

test(
  "Auto Detect reports only a genuinely detected replay folder",
  () => {
    const handler =
      mainSource.match(
        /ipcMain\.handle\("watcher:get-default-replay-dir"[\s\S]*?\n\s*\}\);/
      )?.[0] || "";

    assert.ok(
      handler.length > 0,
      "Auto Detect IPC handler must exist"
    );

    assert.match(
      handler,
      /detectReplayFolder\(\)\?\.path \|\| ""/
    );

    assert.doesNotMatch(
      handler,
      /getDefaultReplayDir\(\)/,
      "Auto Detect must not present a guessed fallback as detection"
    );
  }
);
