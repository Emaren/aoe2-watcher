const chokidar = require("chokidar");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

function firstExistingPath(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return paths[0] || null;
}

function getDefaultReplayDir() {
  const home = os.homedir();
  const platform = os.platform();

  if (platform === "darwin") {
    return firstExistingPath([
      path.join(
        home,
        "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Age2HD/SaveGame"
      ),
      path.join(
        home,
        "Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/My Documents/My Games/Age of Empires 2 HD/SaveGame"
      ),
      path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
      path.join(home, "Documents", "My Games", "Age of Empires 2 DE", "SaveGame"),
    ]);
  }
  if (platform === "win32") {
    return firstExistingPath([
      path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
      path.join(home, "Documents", "My Games", "Age of Empires 2 DE", "SaveGame"),
    ]);
  }
  return firstExistingPath([
    path.join(
      home,
      ".wine/drive_c/Program Files (x86)/Microsoft Games/Age of Empires II HD/SaveGame"
    ),
    path.join(home, ".wine/drive_c/users", os.userInfo().username, "My Documents/My Games/Age of Empires 2 HD/SaveGame"),
    path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
  ]);
}

const API_BASE_URL = (process.env.AOE2_API_BASE_URL || "https://api-prodn.aoe2hdbets.com").replace(/\/$/, "");
const UPLOAD_URL = `${API_BASE_URL}/api/replay/upload`;
const WATCH_DIR = process.env.AOE2_WATCH_DIR || getDefaultReplayDir();
const WATCH_EXTENSIONS = new Set([".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"]);
const UPLOAD_API_KEY = process.env.AOE2_UPLOAD_API_KEY?.trim();
const MAX_UPLOAD_RETRIES = Number(process.env.AOE2_UPLOAD_RETRY_ATTEMPTS || 4);
const RETRY_BASE_DELAY_MS = Number(process.env.AOE2_UPLOAD_RETRY_BASE_DELAY_MS || 4000);
const STABLE_CHECK_INTERVAL_MS = Number(process.env.AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS || 3000);
const QUIET_PERIOD_MS = Number(process.env.AOE2_UPLOAD_QUIET_PERIOD_MS || 30000);
const INITIAL_LIVE_DELAY_MS = Number(process.env.AOE2_INITIAL_LIVE_DELAY_MS || 3000);
const INITIAL_LIVE_RETRY_COOLDOWN_MS = Number(
  process.env.AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS || 10000
);
const LIVE_UPLOAD_COOLDOWN_MS = Number(process.env.AOE2_LIVE_UPLOAD_COOLDOWN_MS || 45000);
const FIRST_BYTES_TIMEOUT_MS = Number(process.env.AOE2_FIRST_BYTES_TIMEOUT_MS || 30000);
const FIRST_BYTES_POLL_MS = Number(process.env.AOE2_FIRST_BYTES_POLL_MS || 1000);
const MIN_REPLAY_BYTES = Number(process.env.AOE2_MIN_REPLAY_BYTES || 1);
const WATCHER_UID =
  process.env.WATCHER_USER_UID ||
  `watcher-${crypto.createHash("sha1").update(os.hostname()).digest("hex").slice(0, 12)}`;
const uploadState = new Map();

function getRetryDelayMs(attempt) {
  return Math.min(RETRY_BASE_DELAY_MS * Math.max(1, 2 ** Math.max(0, attempt - 1)), 30000);
}

async function getFileFingerprint(filePath) {
  const stats = await fs.promises.stat(filePath);
  return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
}

function getStateEntry(filePath) {
  let entry = uploadState.get(filePath);
  if (!entry) {
    entry = {
      monitoring: false,
      lastObservedFingerprint: null,
      lastChangeAt: 0,
      lastLiveAttemptAt: 0,
      lastLiveUploadAt: 0,
      lastLiveUploadedFingerprint: null,
      lastFinalUploadedFingerprint: null,
      liveIteration: 0,
    };
    uploadState.set(filePath, entry);
  }
  return entry;
}

function formatResponseBody(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data.message === "string") return data.message;
  if (typeof data.detail === "string") return data.detail;

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function shouldHandle(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!WATCH_EXTENSIONS.has(ext)) return false;
  if (filePath.includes("Out of Sync")) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFirstBytes(filePath) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= FIRST_BYTES_TIMEOUT_MS) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Replay disappeared before first parse: ${path.basename(filePath)}`);
      return false;
    }

    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.size >= MIN_REPLAY_BYTES) {
        return true;
      }
    } catch (err) {
      console.warn(`Unable to inspect ${path.basename(filePath)} before live parse:`, err.message);
      return false;
    }

    await sleep(FIRST_BYTES_POLL_MS);
  }

  console.warn(`Replay never reached minimum size: ${path.basename(filePath)}`);
  return false;
}

async function uploadReplay(filePath, { parseIteration = 1, isFinal = true } = {}) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), path.basename(filePath));
  const headers = {
    ...form.getHeaders(),
    "x-user-uid": WATCHER_UID,
    "x-parse-iteration": String(parseIteration),
    "x-is-final": isFinal ? "true" : "false",
    "x-parse-source": isFinal ? "watcher_final" : "watcher_live",
    "x-parse-reason": isFinal ? "watcher_final_submission" : "watcher_live_iteration",
  };
  if (UPLOAD_API_KEY) {
    headers["x-api-key"] = UPLOAD_API_KEY;
  }

  const res = await axios.post(UPLOAD_URL, form, {
    timeout: 60000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers,
  });
  return res;
}

function isRetryableUploadError(error) {
  const status = error?.response?.status;
  const detail = formatResponseBody(error?.response?.data).toLowerCase();

  if (!error?.response) {
    return true;
  }

  if (status === 422 && detail.includes("failed to parse replay file")) {
    return true;
  }

  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function uploadReplayWithRetry(filePath, entry, { fingerprint, parseIteration, isFinal }) {
  const maxAttempts = isFinal ? MAX_UPLOAD_RETRIES + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryLabel = attempt > 0 ? ` (retry ${attempt}/${MAX_UPLOAD_RETRIES})` : "";
    console.log(
      `${isFinal ? "Uploading final replay" : "Uploading live replay"}: ${filePath} ` +
        `[iteration ${parseIteration}]${retryLabel}`
    );

    try {
      const res = await uploadReplay(filePath, { parseIteration, isFinal });
      const detail = formatResponseBody(res.data);

      if (isFinal || detail.toLowerCase().includes("already parsed as final")) {
        entry.lastFinalUploadedFingerprint = fingerprint;
      } else {
        entry.lastLiveUploadedFingerprint = fingerprint;
        entry.liveIteration = parseIteration;
        entry.lastLiveUploadAt = Date.now();
      }

      console.log(
        `Uploaded (${res.status}): ${path.basename(filePath)}${detail ? ` - ${detail}` : ""}`
      );
      return true;
    } catch (err) {
      const responseDetail = formatResponseBody(err?.response?.data);
      const prefix = isFinal ? "Final upload failed" : "Live upload failed";
      console.error(`${prefix} for ${path.basename(filePath)}:`, err.message);
      if (err.response) {
        console.error("Server response:", err.response.status, err.response.data);
      }

      if (!isFinal) {
        return false;
      }

      if (!isRetryableUploadError(err) || attempt >= maxAttempts - 1) {
        return false;
      }

      const delayMs = getRetryDelayMs(attempt + 1);
      console.warn(
        `Retrying ${path.basename(filePath)} in ${Math.round(delayMs / 1000)}s ` +
          `(attempt ${attempt + 1}/${MAX_UPLOAD_RETRIES}) because ${responseDetail || err.message}`
      );
      await sleep(delayMs);
    }
  }

  return false;
}

async function monitorReplayFile(filePath) {
  if (!shouldHandle(filePath)) return;

  const entry = getStateEntry(filePath);
  if (entry.monitoring) {
    return;
  }

  entry.monitoring = true;

  try {
    if (!(await waitForFirstBytes(filePath))) {
      return;
    }

    if (INITIAL_LIVE_DELAY_MS > 0) {
      await sleep(INITIAL_LIVE_DELAY_MS);
    }

    while (true) {
      if (!fs.existsSync(filePath)) {
        console.warn(`Replay removed before final upload: ${path.basename(filePath)}`);
        return;
      }

      let fingerprint;
      try {
        fingerprint = await getFileFingerprint(filePath);
      } catch (err) {
        console.error(`Unable to inspect ${path.basename(filePath)}:`, err.message);
        return;
      }

      if (
        fingerprint === entry.lastFinalUploadedFingerprint &&
        fingerprint === entry.lastObservedFingerprint
      ) {
        return;
      }

      const now = Date.now();
      const changed = fingerprint !== entry.lastObservedFingerprint;

      if (changed) {
        entry.lastObservedFingerprint = fingerprint;
        entry.lastChangeAt = now;

        const liveCooldownMs =
          entry.liveIteration === 0 ? INITIAL_LIVE_RETRY_COOLDOWN_MS : LIVE_UPLOAD_COOLDOWN_MS;
        const lastLiveAnchorAt =
          entry.liveIteration === 0 ? entry.lastLiveAttemptAt : entry.lastLiveUploadAt;
        const readyForLiveUpload =
          fingerprint !== entry.lastLiveUploadedFingerprint &&
          (lastLiveAnchorAt === 0 || now - lastLiveAnchorAt >= liveCooldownMs);

        if (readyForLiveUpload) {
          const nextIteration = entry.liveIteration + 1;
          entry.lastLiveAttemptAt = now;
          await uploadReplayWithRetry(filePath, entry, {
            fingerprint,
            parseIteration: nextIteration,
            isFinal: false,
          });
        }
      } else if (
        fingerprint !== entry.lastFinalUploadedFingerprint &&
        entry.lastChangeAt > 0 &&
        now - entry.lastChangeAt >= QUIET_PERIOD_MS
      ) {
        const nextIteration = Math.max(1, entry.liveIteration + 1);
        const stored = await uploadReplayWithRetry(filePath, entry, {
          fingerprint,
          parseIteration: nextIteration,
          isFinal: true,
        });

        if (stored) {
          return;
        }
      }

      await sleep(STABLE_CHECK_INTERVAL_MS);
    }
  } finally {
    entry.monitoring = false;
  }
}

async function onFileDetected(filePath) {
  void monitorReplayFile(filePath);
}

function startWatching() {
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`Replay directory does not exist: ${WATCH_DIR}`);
    console.error("Set AOE2_WATCH_DIR in .env to your SaveGame folder and restart.");
    return null;
  }

  console.log(`Watching directory: ${WATCH_DIR}`);
  console.log(`Upload endpoint: ${UPLOAD_URL}`);
  console.log(`Watcher UID: ${WATCHER_UID}`);

  const watcher = chokidar.watch(WATCH_DIR, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
  });

  watcher.on("add", onFileDetected);
  watcher.on("change", onFileDetected);
  watcher.on("error", (err) => console.error("Watcher error:", err.message));

  return watcher;
}

module.exports = {
  getDefaultReplayDir,
  getRetryDelayMs,
  isRetryableUploadError,
  monitorReplayFile,
  startWatching,
};
