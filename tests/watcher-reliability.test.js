const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createReplayUploadSnapshot,
  detectReplayFolder,
  inspectReplayFolder,
} = require("../watcher");

function temporaryFolder(segment) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aoe2-watcher-"));
  const folder = path.join(root, ...segment);
  fs.mkdirSync(folder, { recursive: true });
  return { root, folder };
}

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
