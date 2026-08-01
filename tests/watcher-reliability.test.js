const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createReplayUploadSnapshot,
  inspectReplayFolder,
} = require("../watcher");

function temporaryFolder(segment) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aoe2-watcher-"));
  const folder = path.join(root, ...segment);
  fs.mkdirSync(folder, { recursive: true });
  return { root, folder };
}

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
