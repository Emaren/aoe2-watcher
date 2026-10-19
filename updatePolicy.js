const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAC_IDENTITY_TIMEOUT_MS = 5000;
const MAC_IDENTITY_MAX_BUFFER_BYTES = 64 * 1024;

function getUpdateCapability({
  platform,
  isPackaged = false,
  macAutoUpdateEnabled = false,
  macSignatureVerified = false,
  appImagePath,
  portableExecutablePath,
} = {}) {
  if (platform === "darwin") {
    if (isPackaged !== true || macAutoUpdateEnabled !== true) {
      return { automatic: false, manualReason: "mac_manual_unsigned" };
    }
    return macSignatureVerified === true
      ? { automatic: true, manualReason: null }
      : { automatic: false, manualReason: "mac_signing_unverified" };
  }

  if (platform === "win32") {
    if (typeof portableExecutablePath === "string" && portableExecutablePath.length > 0) {
      return { automatic: false, manualReason: "windows_portable" };
    }
    return isPackaged === true
      ? { automatic: true, manualReason: null }
      : { automatic: false, manualReason: "development_mode" };
  }

  if (platform === "linux") {
    const validAppImagePath =
      typeof appImagePath === "string" &&
      path.posix.isAbsolute(appImagePath) &&
      !appImagePath.includes("\0");
    return isPackaged === true && validAppImagePath
      ? { automatic: true, manualReason: null }
      : { automatic: false, manualReason: "linux_non_appimage" };
  }

  return { automatic: false, manualReason: "unsupported_platform" };
}

function parseStableVersion(version) {
  if (typeof version !== "string" || version.length > 128) return null;
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    return null;
  }
  return version.split(".").map((component) => BigInt(component));
}

function isStableNewerVersion(candidate, current) {
  const next = parseStableVersion(candidate);
  const previous = parseStableVersion(current);
  if (!next || !previous) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] > previous[index]) return true;
    if (next[index] < previous[index]) return false;
  }
  return false;
}

function getMacAppBundle(execPath) {
  if (
    typeof execPath !== "string" ||
    !path.posix.isAbsolute(execPath) ||
    execPath.includes("\0") ||
    path.posix.normalize(execPath) !== execPath
  ) {
    return null;
  }
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return match ? match[1] : null;
}

function verifyMacUpdateIdentity(execPath, run = spawnSync) {
  const appBundle = getMacAppBundle(execPath);
  if (!appBundle || typeof run !== "function") {
    return { verified: false, reason: "mac_executable_unbound" };
  }

  const options = {
    encoding: "utf8",
    shell: false,
    timeout: MAC_IDENTITY_TIMEOUT_MS,
    maxBuffer: MAC_IDENTITY_MAX_BUFFER_BYTES,
    windowsHide: true,
  };
  const invoke = (command, args) => {
    try {
      const result = run(command, args, { ...options });
      if (!result || result.error || result.signal || result.status !== 0) return null;
      return `${result.stdout || ""}\n${result.stderr || ""}`;
    } catch {
      return null;
    }
  };

  if (invoke("/usr/bin/codesign", ["--verify", "--deep", "--strict", appBundle]) === null) {
    return { verified: false, reason: "mac_signature_invalid" };
  }
  const identity = invoke("/usr/bin/codesign", ["-dv", "--verbose=2", appBundle]);
  if (
    identity === null ||
    !/^Authority=Developer ID Application: .+$/m.test(identity)
  ) {
    return { verified: false, reason: "mac_developer_id_unverified" };
  }
  const assessment = invoke("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appBundle]);
  if (assessment === null || !/^source=Notarized Developer ID\s*$/m.test(assessment)) {
    return { verified: false, reason: "mac_notarization_unverified" };
  }
  return { verified: true, reason: null };
}

module.exports = {
  getUpdateCapability,
  isStableNewerVersion,
  verifyMacUpdateIdentity,
};
