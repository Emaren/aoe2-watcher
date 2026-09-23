const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  closeReplayUploadStream,
  createReplayUploadSnapshot,
  disposeReplayUploadSnapshot,
  detectReplayFolder,
  getWindowsSteamRoots,
  inspectReplayFolder,
  isRetryableUploadError,
  parseWindowsRegistryStringValue,
  pruneSettledUploadState,
  selectPreferredReplayFolder,
  shouldSwitchReplayFolder,
} = require("../watcher");

test("live recovery scan is wired to fresh-unknown admission and has no English filename veto", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "watcher.js"), "utf8");

  assert.match(source, /freshUnknown = shouldRecoverUnknownReplayCandidate/);
  assert.match(source, /recent_unknown_replay_on_attach/);
  assert.doesNotMatch(source, /filePath\.includes\("Out of Sync"\)/);
});

function temporaryFolder(segment) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aoe2-watcher-"));
  const folder = path.join(root, ...segment);
  fs.mkdirSync(folder, { recursive: true });
  return { root, folder };
}


test("parses custom Steam install roots from Windows registry output", () => {
  const roots = parseWindowsRegistryStringValue(`
HKEY_CURRENT_USER\Software\Valve\Steam
    SteamPath    REG_SZ    D:/Games/Steam
`);

  assert.deepEqual(roots, ["D:/Games/Steam"]);
});

test("Windows Steam roots include registry-discovered custom installs", () => {
  const customSteamRoot = "D:\\SteamCustom";
  const roots = getWindowsSteamRoots({ registryRoots: [customSteamRoot] });

  assert.ok(roots.includes(customSteamRoot));
});

test("auto-detects Steam Age2HD multiplayer SaveGame folder", () => {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "aoe2-watcher-steam-"
      )
    );

  const programFilesX86 =
    path.join(
      root,
      "Program Files (x86)"
    );

  const replayFolder =
    path.join(
      programFilesX86,
      "Steam",
      "steamapps",
      "common",
      "Age2HD",
      "SaveGame",
      "multi"
    );

  const previousPlatform =
    os.platform;

  const savedEnv = {
    programFilesX86:
      process.env["ProgramFiles(x86)"],
    programFiles:
      process.env.ProgramFiles,
    programW6432:
      process.env.ProgramW6432,
    userProfile:
      process.env.USERPROFILE,
    oneDrive:
      process.env.OneDrive,
    oneDriveCommercial:
      process.env.OneDriveCommercial,
    oneDriveConsumer:
      process.env.OneDriveConsumer,
  };

  const restoreEnv = (
    key,
    value
  ) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  try {
    fs.mkdirSync(
      replayFolder,
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      path.join(
        replayFolder,
        "scavanger.aoe2mpgame"
      ),
      Buffer.alloc(8)
    );

    os.platform =
      () => "win32";

    process.env["ProgramFiles(x86)"] =
      programFilesX86;

    process.env.ProgramFiles =
      path.join(
        root,
        "Program Files"
      );

    process.env.ProgramW6432 =
      process.env.ProgramFiles;

    process.env.USERPROFILE =
      path.join(
        root,
        "EmptyProfile"
      );

    delete process.env.OneDrive;
    delete process.env.OneDriveCommercial;
    delete process.env.OneDriveConsumer;

    const detected =
      detectReplayFolder();

    assert.ok(
      detected,
      "Steam multiplayer replay folder should be detected"
    );

    assert.equal(
      detected.path,
      replayFolder
    );

    assert.equal(
      detected.valid,
      true
    );

    assert.equal(
      detected.kind,
      "hd"
    );

    assert.equal(
      detected.supportedReplayCount,
      1
    );
  } finally {
    os.platform =
      previousPlatform;

    restoreEnv(
      "ProgramFiles(x86)",
      savedEnv.programFilesX86
    );

    restoreEnv(
      "ProgramFiles",
      savedEnv.programFiles
    );

    restoreEnv(
      "ProgramW6432",
      savedEnv.programW6432
    );

    restoreEnv(
      "USERPROFILE",
      savedEnv.userProfile
    );

    restoreEnv(
      "OneDrive",
      savedEnv.oneDrive
    );

    restoreEnv(
      "OneDriveCommercial",
      savedEnv.oneDriveCommercial
    );

    restoreEnv(
      "OneDriveConsumer",
      savedEnv.oneDriveConsumer
    );

    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});

test("auto-detects Age2HD in a custom Steam library", () => {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "aoe2-watcher-steam-library-"
      )
    );

  const programFilesX86 =
    path.join(
      root,
      "Program Files (x86)"
    );

  const steamRoot =
    path.join(
      programFilesX86,
      "Steam"
    );

  const customLibrary =
    path.join(
      root,
      "D",
      "SteamLibrary"
    );

  const replayFolder =
    path.join(
      customLibrary,
      "steamapps",
      "common",
      "Age2HD",
      "SaveGame",
      "multi"
    );

  const previousPlatform =
    os.platform;

  const savedEnv = {
    programFilesX86:
      process.env["ProgramFiles(x86)"],
    programFiles:
      process.env.ProgramFiles,
    programW6432:
      process.env.ProgramW6432,
    userProfile:
      process.env.USERPROFILE,
    oneDrive:
      process.env.OneDrive,
    oneDriveCommercial:
      process.env.OneDriveCommercial,
    oneDriveConsumer:
      process.env.OneDriveConsumer,
  };

  const restoreEnv = (
    key,
    value
  ) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  try {
    fs.mkdirSync(
      path.join(
        steamRoot,
        "steamapps"
      ),
      {
        recursive: true,
      }
    );

    fs.mkdirSync(
      replayFolder,
      {
        recursive: true,
      }
    );

    const escapedLibrary =
      customLibrary
        .replace(/\\/g, "\\\\");

    fs.writeFileSync(
      path.join(
        steamRoot,
        "steamapps",
        "libraryfolders.vdf"
      ),
      `"libraryfolders"
{
  "0"
  {
    "path" "${escapedLibrary}"
  }
}
`
    );

    fs.writeFileSync(
      path.join(
        replayFolder,
        "custom-library.aoe2mpgame"
      ),
      Buffer.alloc(8)
    );

    os.platform =
      () => "win32";

    process.env["ProgramFiles(x86)"] =
      programFilesX86;

    process.env.ProgramFiles =
      path.join(
        root,
        "Program Files"
      );

    process.env.ProgramW6432 =
      process.env.ProgramFiles;

    process.env.USERPROFILE =
      path.join(
        root,
        "EmptyProfile"
      );

    delete process.env.OneDrive;
    delete process.env.OneDriveCommercial;
    delete process.env.OneDriveConsumer;

    const detected =
      detectReplayFolder();

    assert.ok(
      detected,
      "custom Steam library should be discovered"
    );

    assert.equal(
      detected.path,
      replayFolder
    );

    assert.equal(
      detected.valid,
      true
    );

    assert.equal(
      detected.kind,
      "hd"
    );
  } finally {
    os.platform =
      previousPlatform;

    restoreEnv(
      "ProgramFiles(x86)",
      savedEnv.programFilesX86
    );

    restoreEnv(
      "ProgramFiles",
      savedEnv.programFiles
    );

    restoreEnv(
      "ProgramW6432",
      savedEnv.programW6432
    );

    restoreEnv(
      "USERPROFILE",
      savedEnv.userProfile
    );

    restoreEnv(
      "OneDrive",
      savedEnv.oneDrive
    );

    restoreEnv(
      "OneDriveCommercial",
      savedEnv.oneDriveCommercial
    );

    restoreEnv(
      "OneDriveConsumer",
      savedEnv.oneDriveConsumer
    );

    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});

test("fresh replay activity outranks a stale folder with more historical files", () => {
  const now = Date.now();
  const activeFolder = {
    path: "C:\\active\\SaveGame",
    valid: true,
    score: 34,
    supportedReplayCount: 1,
    latestReplayModifiedAt: new Date(now - 30 * 1000).toISOString(),
  };
  const staleFolder = {
    path: "C:\\stale\\SaveGame",
    valid: true,
    score: 70,
    supportedReplayCount: 20,
    latestReplayModifiedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
  };

  assert.equal(
    selectPreferredReplayFolder(
      [staleFolder, activeFolder],
      now,
    ),
    activeFolder,
  );
});

test("valid stale folder switches only to materially fresher proven activity", () => {
  const now = Date.now();
  const current = {
    path: "C:\\old\\SaveGame",
    valid: true,
    latestReplayModifiedAt: new Date(now - 15 * 60 * 1000).toISOString(),
  };
  const fresh = {
    path: "D:\\SteamLibrary\\Age2HD\\SaveGame\\multi",
    valid: true,
    latestReplayModifiedAt: new Date(now - 30 * 1000).toISOString(),
  };

  assert.equal(
    shouldSwitchReplayFolder(
      current,
      fresh,
      { now },
    ),
    true,
  );

  assert.equal(
    shouldSwitchReplayFolder(
      {
        ...current,
        latestReplayModifiedAt: new Date(now - 90 * 1000).toISOString(),
      },
      fresh,
      { now },
    ),
    false,
    "a recently active current folder must not be displaced",
  );

  assert.equal(
    shouldSwitchReplayFolder(
      current,
      {
        ...fresh,
        latestReplayModifiedAt: new Date(now - 10 * 60 * 1000).toISOString(),
      },
      { now },
    ),
    false,
    "a stale alternative must not trigger a switch",
  );

  assert.equal(
    shouldSwitchReplayFolder(
      current,
      {
        ...fresh,
        path: current.path,
      },
      { now },
    ),
    false,
    "the same folder is never a switch candidate",
  );
});

test("accepts a readable AoE2 HD SaveGame folder", () => {
  const { root, folder } = temporaryFolder(["Documents", "My Games", "Age of Empires 2 HD", "SaveGame"]);
  try {
    fs.writeFileSync(path.join(folder, "recent.aoe2record"), Buffer.alloc(8));
    const result = inspectReplayFolder(folder);
    assert.equal(result.valid, true);
    assert.equal(result.kind, "hd");
    assert.equal(result.supportedReplayCount, 1);
    assert.equal(result.latestReplayBasename, "recent.aoe2record");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("never accepts an AoE2 DE folder for the HD watcher", () => {
  const { root, folder } = temporaryFolder(["Documents", "My Games", "Age of Empires 2 DE", "SaveGame"]);
  try {
    fs.writeFileSync(path.join(folder, "recent.aoe2record"), Buffer.alloc(8));
    const result = inspectReplayFolder(folder);
    assert.equal(result.valid, false);
    assert.equal(result.kind, "de");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a manually selected folder only with HD replay evidence", () => {
  const { root, folder } = temporaryFolder(["custom", "SaveGame"]);
  try {
    assert.equal(inspectReplayFolder(folder).valid, false);
    fs.writeFileSync(path.join(folder, "match.mgz"), Buffer.alloc(8));
    assert.equal(inspectReplayFolder(folder).valid, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("captures immutable replay bytes and matching transport metadata", async () => {
  const { root, folder } =
    temporaryFolder([
      "Documents",
      "My Games",
      "Age of Empires 2 HD",
      "SaveGame",
    ]);

  const sourcePath =
    path.join(
      folder,
      "growing.aoe2record"
    );

  try {
    fs.writeFileSync(
      sourcePath,
      "first-pass"
    );

    const snapshot =
      await createReplayUploadSnapshot(
        sourcePath
      );

    fs.appendFileSync(
      sourcePath,
      "-continued-growth"
    );

    assert.equal(
      snapshot
        .replayBuffer
        .toString("utf8"),
      "first-pass"
    );

    assert.equal(
      snapshot.fileSizeBytes,
      Buffer.byteLength(
        "first-pass"
      )
    );

    assert.equal(
      snapshot
        .fingerprint
        .split(":")[0],
      String(
        snapshot.fileSizeBytes
      )
    );

    assert.equal(
      fs.readFileSync(
        sourcePath,
        "utf8"
      ),
      "first-pass-continued-growth"
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});


test("historical upload snapshots are disk-backed and disposable", async () => {
  const { root, folder } =
    temporaryFolder([
      "Documents",
      "My Games",
      "Age of Empires 2 HD",
      "SaveGame",
    ]);

  const sourcePath =
    path.join(
      folder,
      "historical.aoe2record"
    );

  let snapshot = null;

  try {
    fs.writeFileSync(
      sourcePath,
      "historical-replay-bytes"
    );

    snapshot =
      await createReplayUploadSnapshot(
        sourcePath,
        {
          storage: "disk",
        }
      );

    assert.equal(
      snapshot.storage,
      "disk"
    );
    assert.equal(
      snapshot.replayBuffer,
      null
    );
    assert.ok(
      snapshot.snapshotPath
    );
    assert.equal(
      fs.readFileSync(
        snapshot.snapshotPath,
        "utf8"
      ),
      "historical-replay-bytes"
    );

    fs.appendFileSync(
      sourcePath,
      "-source-can-change-after-snapshot"
    );

    assert.equal(
      fs.readFileSync(
        snapshot.snapshotPath,
        "utf8"
      ),
      "historical-replay-bytes"
    );

    const snapshotDirectory =
      snapshot.snapshotDirectory;

    await disposeReplayUploadSnapshot(
      snapshot
    );
    snapshot = null;

    assert.equal(
      fs.existsSync(
        snapshotDirectory
      ),
      false
    );
  } finally {
    if (snapshot) {
      await disposeReplayUploadSnapshot(
        snapshot
      );
    }
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});

test("historical parser failures do not enter live replay growth retry loops", () => {
  const error = {
    response: {
      status: 422,
      data: {
        detail:
          "Failed to parse replay file",
      },
    },
  };

  assert.equal(
    isRetryableUploadError(
      error
    ),
    true
  );

  assert.equal(
    isRetryableUploadError(
      error,
      {
        allowReplayProgressRetry:
          false,
      }
    ),
    false
  );
});

test("historical import selects disk snapshots and disables replay-progress retry semantics", () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "watcher.js"
      ),
      "utf8"
    );

  assert.match(
    source,
    /historicalImport\s*=\s*[\s\S]*WATCHER_PROVENANCE_HISTORICAL_IMPORT/
  );
  assert.match(
    source,
    /storage:\s*historicalImport[\s\S]*\? "disk"[\s\S]*: "memory"/
  );
  assert.match(
    source,
    /allowReplayProgressRetry:\s*!historicalImport/
  );
  assert.match(
    source,
    /!historicalImport\s*&&\s*isReplayFinalizingError\(err\)/
  );
});


test("disk-backed upload streams close before snapshot cleanup", async () => {
  const { root, folder } =
    temporaryFolder([
      "Documents",
      "My Games",
      "Age of Empires 2 HD",
      "SaveGame",
    ]);

  const sourcePath =
    path.join(
      folder,
      "cleanup.aoe2record"
    );

  let snapshot = null;

  try {
    fs.writeFileSync(
      sourcePath,
      "cleanup-replay-bytes"
    );

    snapshot =
      await createReplayUploadSnapshot(
        sourcePath,
        {
          storage: "disk",
        }
      );

    const stream =
      fs.createReadStream(
        snapshot.snapshotPath
      );

    await closeReplayUploadStream(
      stream
    );

    assert.equal(
      stream.closed,
      true
    );

    const snapshotDirectory =
      snapshot.snapshotDirectory;

    assert.equal(
      await disposeReplayUploadSnapshot(
        snapshot
      ),
      true
    );
    snapshot = null;

    assert.equal(
      fs.existsSync(
        snapshotDirectory
      ),
      false
    );
  } finally {
    if (snapshot) {
      await disposeReplayUploadSnapshot(
        snapshot
      );
    }
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});


test("settled replay runtime state is bounded to the newest entries", () => {
  const state = new Map([
    [
      "old.aoe2record",
      {
        finalStored: true,
        finalAccepted: false,
        lastFinalUploadedFingerprint: "10:1",
        lastFinalReplayHash: "old",
        lastFinalUploadAt: 100,
        monitoring: false,
        importing: false,
      },
    ],
    [
      "new.aoe2record",
      {
        finalStored: true,
        finalAccepted: true,
        lastFinalUploadedFingerprint: "20:2",
        lastFinalReplayHash: "new",
        lastFinalUploadAt: 300,
        monitoring: false,
        importing: false,
      },
    ],
    [
      "middle.aoe2record",
      {
        finalStored: true,
        finalAccepted: false,
        lastFinalUploadedFingerprint: "15:2",
        lastFinalReplayHash: "middle",
        lastFinalUploadAt: 200,
        monitoring: false,
        importing: false,
      },
    ],
  ]);

  const result =
    pruneSettledUploadState(
      state,
      2
    );

  assert.equal(result.removed, 1);
  assert.equal(state.size, 2);
  assert.equal(
    state.has("old.aoe2record"),
    false
  );
  assert.equal(
    state.has("new.aoe2record"),
    true
  );
  assert.equal(
    state.has("middle.aoe2record"),
    true
  );
});

test("historical scan does not allocate replay state for every file and persists once after the batch", () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "watcher.js"
      ),
      "utf8"
    );

  const scanStart =
    source.indexOf(
      "const queue = [];"
    );
  const processStart =
    source.indexOf(
      "for (let index = 0; index < queue.length",
      scanStart
    );
  const scanBlock =
    source.slice(
      scanStart,
      processStart
    );

  assert.match(
    scanBlock,
    /activeUploadState\.get/
  );
  assert.doesNotMatch(
    scanBlock,
    /getStateEntry/
  );

  assert.match(
    source,
    /finalStored\s*&&\s*!historicalImport[\s\S]*persistSettlementState/
  );

  assert.match(
    source,
    /const statePrune =\s*pruneSettledUploadState\(\);[\s\S]*persistSettlementState\(\);/
  );

  assert.match(
    source,
    /transientImportEntry[\s\S]*activeUploadState\.delete/
  );
});
