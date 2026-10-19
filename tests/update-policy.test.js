const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getUpdateCapability,
  isStableNewerVersion,
  verifyMacUpdateIdentity,
} = require("../updatePolicy");

const EXEC_PATH = "/Applications/AoE2HDBets Watcher.app/Contents/MacOS/AoE2HDBets Watcher";
const APP_BUNDLE = "/Applications/AoE2HDBets Watcher.app";

function fakeIdentityRun(overrides = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    const phase = args[0] === "--verify" ? "verify" : args[0] === "-dv" ? "identity" : "assessment";
    if (Object.hasOwn(overrides, phase)) {
      const override = overrides[phase];
      if (override instanceof Error) throw override;
      return override;
    }
    return {
      status: 0,
      stdout: "",
      stderr: phase === "identity"
        ? "Authority=Developer ID Application: Test Publisher (TEST123456)\nAuthority=Developer ID Certification Authority\n"
        : phase === "assessment"
          ? `${APP_BUNDLE}: accepted\nsource=Notarized Developer ID\n`
          : "",
    };
  };
  return { calls, run };
}

test("macOS automatic updates require packaged build, explicit opt-in, and verified identity", () => {
  assert.deepEqual(getUpdateCapability({ platform: "darwin", isPackaged: true }), {
    automatic: false, manualReason: "mac_manual_unsigned",
  });
  assert.deepEqual(getUpdateCapability({ platform: "darwin", isPackaged: true, macAutoUpdateEnabled: true }), {
    automatic: false, manualReason: "mac_signing_unverified",
  });
  assert.equal(getUpdateCapability({ platform: "darwin", isPackaged: true, macAutoUpdateEnabled: "1", macSignatureVerified: true }).automatic, false);
  assert.equal(getUpdateCapability({ platform: "darwin", isPackaged: false, macAutoUpdateEnabled: true, macSignatureVerified: true }).automatic, false);
  assert.equal(getUpdateCapability({ platform: "darwin", isPackaged: true, macAutoUpdateEnabled: true, macSignatureVerified: "true" }).automatic, false);
  assert.deepEqual(getUpdateCapability({ platform: "darwin", isPackaged: true, macAutoUpdateEnabled: true, macSignatureVerified: true }), {
    automatic: true, manualReason: null,
  });
});

test("Windows automatic updates support installed NSIS builds and reject portable/source execution", () => {
  assert.deepEqual(getUpdateCapability({ platform: "win32", isPackaged: true }), { automatic: true, manualReason: null });
  assert.deepEqual(getUpdateCapability({ platform: "win32", isPackaged: true, portableExecutablePath: "C:\\Watcher.exe" }), {
    automatic: false, manualReason: "windows_portable",
  });
  assert.equal(getUpdateCapability({ platform: "win32", isPackaged: false }).automatic, false);
});

test("Linux automatic updates require a packaged AppImage with an absolute valid path", () => {
  assert.deepEqual(getUpdateCapability({ platform: "linux", isPackaged: true, appImagePath: "/home/player/Watcher.AppImage" }), {
    automatic: true, manualReason: null,
  });
  for (const appImagePath of [undefined, "", "Watcher.AppImage", "/tmp/Watcher\0.AppImage"]) {
    assert.deepEqual(getUpdateCapability({ platform: "linux", isPackaged: true, appImagePath }), {
      automatic: false, manualReason: "linux_non_appimage",
    });
  }
  assert.equal(getUpdateCapability({ platform: "linux", isPackaged: false, appImagePath: "/tmp/Watcher.AppImage" }).automatic, false);
  assert.deepEqual(getUpdateCapability({ platform: "freebsd", isPackaged: true }), {
    automatic: false, manualReason: "unsupported_platform",
  });
});

test("stable version selection accepts only strictly newer major/minor/patch releases", () => {
  for (const candidate of ["1.6.4", "1.7.0", "2.0.0", "10.0.0"]) {
    assert.equal(isStableNewerVersion(candidate, "1.6.3"), true, candidate);
  }
  for (const candidate of ["1.6.3", "1.6.2", "1.5.99", "0.99.99"]) {
    assert.equal(isStableNewerVersion(candidate, "1.6.3"), false, candidate);
  }
  assert.equal(isStableNewerVersion("9007199254740993.0.0", "9007199254740992.0.0"), true);
});

test("invalid, prerelease, build, prefixed, or leading-zero versions fail closed", () => {
  const invalid = [
    "1.6.4-beta.1", "1.6.4+build.1", "v1.6.4", "01.6.4", "1.06.4", "1.6.04",
    "1.6", "1.6.4.0", " 1.6.4", "1.6.4 ", "1.6.4\n", "-1.6.4", "", null, 164,
  ];
  for (const candidate of invalid) {
    assert.equal(isStableNewerVersion(candidate, "1.6.3"), false, String(candidate));
    assert.equal(isStableNewerVersion("2.0.0", candidate), false, String(candidate));
  }
});

test("macOS verification binds all bounded, shell-free probes to the executable's app bundle", () => {
  const { run, calls } = fakeIdentityRun();
  assert.deepEqual(verifyMacUpdateIdentity(EXEC_PATH, run), { verified: true, reason: null });
  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
    ["/usr/bin/codesign", ["--verify", "--deep", "--strict", APP_BUNDLE]],
    ["/usr/bin/codesign", ["-dv", "--verbose=2", APP_BUNDLE]],
    ["/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", APP_BUNDLE]],
  ]);
  for (const { options } of calls) {
    assert.equal(options.timeout, 5000);
    assert.equal(options.shell, false);
    assert.equal(options.encoding, "utf8");
    assert.equal(options.maxBuffer, 64 * 1024);
  }
});

test("unbound or traversing executable paths cause no identity command", () => {
  for (const execPath of ["Watcher", "/usr/bin/electron", "/Applications/Watcher.app/Contents/MacOS/../Watcher", "/Applications/Watcher.app/Contents/MacOS/Watcher/extra", "/Applications/Watcher.app/Contents/MacOS/Watcher\0", null]) {
    const { run, calls } = fakeIdentityRun();
    assert.deepEqual(verifyMacUpdateIdentity(execPath, run), { verified: false, reason: "mac_executable_unbound" });
    assert.equal(calls.length, 0);
  }
});

test("invalid, corrupt, timed-out, or failed signatures stop before identity/notary assessment", () => {
  for (const failure of [{ status: 1 }, { status: 0, signal: "SIGTERM" }, { status: null, error: new Error("timeout with sensitive text") }, new Error("private failure")]) {
    const { run, calls } = fakeIdentityRun({ verify: failure });
    assert.deepEqual(verifyMacUpdateIdentity(EXEC_PATH, run), { verified: false, reason: "mac_signature_invalid" });
    assert.equal(calls.length, 1);
  }
});

test("ad-hoc, wrong-authority, or missing Developer ID identities remain manual", () => {
  for (const stderr of ["Signature=adhoc\n", "Authority=Apple Development: Test\n", "Authority=Developer ID Certification Authority\n", "not Authority=Developer ID Application: Test\n", ""]) {
    const { run, calls } = fakeIdentityRun({ identity: { status: 0, stderr } });
    const proof = verifyMacUpdateIdentity(EXEC_PATH, run);
    assert.deepEqual(proof, { verified: false, reason: "mac_developer_id_unverified" });
    assert.equal(calls.length, 2);
    assert.equal(getUpdateCapability({ platform: "darwin", isPackaged: true, macAutoUpdateEnabled: true, macSignatureVerified: proof.verified }).automatic, false);
  }
});

test("failed, missing, or wrong notarization proof rejects signed Mac automatic updates", () => {
  for (const assessment of [{ status: 1, stderr: "source=Notarized Developer ID\n" }, { status: 0, stderr: "source=Developer ID\n" }, { status: 0, stderr: "source=Notarized Developer ID forged\n" }, { status: 0, stderr: "" }, new Error("private notary error")]) {
    const { run } = fakeIdentityRun({ assessment });
    const proof = verifyMacUpdateIdentity(EXEC_PATH, run);
    assert.deepEqual(proof, { verified: false, reason: "mac_notarization_unverified" });
    assert.equal(getUpdateCapability({ platform: "darwin", isPackaged: true, macAutoUpdateEnabled: true, macSignatureVerified: proof.verified }).automatic, false);
  }
});
