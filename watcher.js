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
    path.join(
      home,
      ".wine/drive_c/users",
      os.userInfo().username,
      "My Documents/My Games/Age of Empires 2 HD/SaveGame"
    ),
    path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
  ]);
}

function normalizeBaseUrl(value) {
  return (value || "").trim().replace(/\/$/, "");
}

const DEFAULT_API_BASE_URL = "https://api-prodn.aoe2hdbets.com";
const API_BASE_URL = normalizeBaseUrl(process.env.AOE2_API_BASE_URL || DEFAULT_API_BASE_URL);
const DEFAULT_FALLBACK_API_BASE_URL =
  API_BASE_URL === DEFAULT_API_BASE_URL ? "https://aoe2hdbets.com" : "";
const API_FALLBACK_BASE_URL = normalizeBaseUrl(
  process.env.AOE2_API_FALLBACK_BASE_URL || DEFAULT_FALLBACK_API_BASE_URL
);
const UPLOAD_TARGETS = Array.from(
  new Map(
    [API_BASE_URL, API_FALLBACK_BASE_URL]
      .filter(Boolean)
      .map((baseUrl) => [
        baseUrl,
        {
          baseUrl,
          uploadUrl: `${baseUrl}/api/replay/upload`,
        },
      ])
  ).values()
);

const WATCH_DIR = process.env.AOE2_WATCH_DIR || getDefaultReplayDir();
const WATCH_EXTENSIONS = new Set([".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"]);
const UPLOAD_API_KEY = process.env.AOE2_UPLOAD_API_KEY?.trim();

const MAX_UPLOAD_RETRIES = Number(process.env.AOE2_UPLOAD_RETRY_ATTEMPTS || 4);
const RETRY_BASE_DELAY_MS = Number(process.env.AOE2_UPLOAD_RETRY_BASE_DELAY_MS || 4000);
const RETRY_POLL_MS = Number(process.env.AOE2_UPLOAD_RETRY_POLL_MS || 1000);

const STABLE_CHECK_INTERVAL_MS = Number(process.env.AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS || 3000);
const QUIET_PERIOD_MS = Number(process.env.AOE2_UPLOAD_QUIET_PERIOD_MS || 30000);

const INITIAL_LIVE_DELAY_MS = Number(process.env.AOE2_INITIAL_LIVE_DELAY_MS || 3000);
const INITIAL_LIVE_RETRY_COOLDOWN_MS = Number(
  process.env.AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS || 10000
);
const LIVE_UPLOAD_COOLDOWN_MS = Number(process.env.AOE2_LIVE_UPLOAD_COOLDOWN_MS || 45000);
const FINAL_SETTLE_WINDOW_MS = Number(process.env.AOE2_FINAL_SETTLE_WINDOW_MS || 90000);

const FIRST_BYTES_TIMEOUT_MS = Number(process.env.AOE2_FIRST_BYTES_TIMEOUT_MS || 30000);
const FIRST_BYTES_POLL_MS = Number(process.env.AOE2_FIRST_BYTES_POLL_MS || 1000);

const REPLAY_PROGRESS_LOG_INTERVAL_MS = Number(
  process.env.AOE2_REPLAY_PROGRESS_LOG_INTERVAL_MS || 180000
);

// HD replays are not meaningfully parseable at byte 1; a small floor avoids hopeless early uploads
// while still allowing very short completed games to surface.
const MIN_REPLAY_BYTES = Number(process.env.AOE2_MIN_REPLAY_BYTES || 131072);

const WATCHER_UID =
  process.env.WATCHER_USER_UID ||
  `watcher-${crypto.createHash("sha1").update(os.hostname()).digest("hex").slice(0, 12)}`;

const uploadState = new Map();
let preferredUploadTargetBaseUrl = API_BASE_URL;

function getUploadTargetsForAttempt() {
  const preferred = UPLOAD_TARGETS.find((target) => target.baseUrl === preferredUploadTargetBaseUrl);
  const remaining = UPLOAD_TARGETS.filter((target) => target.baseUrl !== preferredUploadTargetBaseUrl);
  return preferred ? [preferred, ...remaining] : [...UPLOAD_TARGETS];
}

function rememberWorkingUploadTarget(target) {
  if (target?.baseUrl) {
    preferredUploadTargetBaseUrl = target.baseUrl;
  }
}

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
      lastFinalUploadAt: 0,
      lastReplayGrowthNoticeAt: 0,
      liveIteration: 0,
    };
    uploadState.set(filePath, entry);
  }
  return entry;
}

function formatResponseBody(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;

  if (Array.isArray(data?.detail)) {
    return data.detail
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return String(entry || "").trim();
        }

        const loc = Array.isArray(entry.loc) ? entry.loc.join(".") : "";
        const msg = typeof entry.msg === "string" ? entry.msg.trim() : "";
        return [loc, msg].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join(" | ");
  }

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

  console.warn(
    `Replay never reached minimum parseable size (${MIN_REPLAY_BYTES} bytes): ${path.basename(filePath)}`
  );
  return false;
}

function isReplayFinalizingError(error) {
  return (
    error?.response?.status === 422 &&
    formatResponseBody(error?.response?.data)
      .toLowerCase()
      .includes("failed to parse replay file")
  );
}

async function waitForReplayProgress(filePath, fingerprint, delayMs) {
  const deadline = Date.now() + delayMs;

  while (Date.now() < deadline) {
    const sleepMs = Math.min(RETRY_POLL_MS, Math.max(1, deadline - Date.now()));
    await sleep(sleepMs);

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const currentFingerprint = await getFileFingerprint(filePath);
      if (currentFingerprint !== fingerprint) {
        return;
      }
    } catch {
      return;
    }
  }
}

function getFormLength(form) {
  return new Promise((resolve, reject) => {
    form.getLength((err, length) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(length);
    });
  });
}

async function syncEntryAfterUpload(filePath, entry, uploadedFingerprint) {
  try {
    const currentFingerprint = await getFileFingerprint(filePath);
    if (currentFingerprint !== uploadedFingerprint) {
      entry.lastObservedFingerprint = currentFingerprint;
      entry.lastChangeAt = Date.now();
      return true;
    }
  } catch (err) {
    console.warn(`Unable to recheck ${path.basename(filePath)} after upload:`, err.message);
  }

  return false;
}

function shouldLogReplayGrowthNotice(entry, isFinal) {
  if (isFinal) {
    entry.lastReplayGrowthNoticeAt = Date.now();
    return true;
  }

  const now = Date.now();
  if (
    entry.lastReplayGrowthNoticeAt === 0 ||
    now - entry.lastReplayGrowthNoticeAt >= REPLAY_PROGRESS_LOG_INTERVAL_MS
  ) {
    entry.lastReplayGrowthNoticeAt = now;
    return true;
  }

  return false;
}

async function uploadReplay(filePath, { parseIteration = 1, isFinal = true, uploadUrl } = {}) {
  const replayBuffer = await fs.promises.readFile(filePath);

  const form = new FormData();
  form.append("file", replayBuffer, {
    filename: path.basename(filePath),
    contentType: "application/octet-stream",
    knownLength: replayBuffer.length,
  });

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

  try {
    headers["Content-Length"] = await getFormLength(form);
  } catch (err) {
    console.warn(`Unable to precompute upload size for ${path.basename(filePath)}:`, err.message);
  }

  const res = await axios.post(uploadUrl, form, {
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
  const hasValidationDetailArray = Array.isArray(error?.response?.data?.detail);

  if (!error?.response) {
    return true;
  }

  if (
    status === 422 &&
    (detail.includes("failed to parse replay file") || hasValidationDetailArray)
  ) {
    return true;
  }

  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isNetworkUploadError(error) {
  return !error?.response;
}

async function uploadReplayWithRetry(filePath, entry, { fingerprint, parseIteration, isFinal }) {
  const maxAttempts = MAX_UPLOAD_RETRIES + 1;
  let attemptFingerprint = fingerprint;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryLabel = attempt > 0 ? ` (retry ${attempt}/${MAX_UPLOAD_RETRIES})` : "";
    const targetSequence = getUploadTargetsForAttempt();

    for (let targetIndex = 0; targetIndex < targetSequence.length; targetIndex += 1) {
      const target = targetSequence[targetIndex];
      const targetHost = new URL(target.uploadUrl).host;

      console.log(
        `${isFinal ? "Uploading final replay" : "Uploading live replay"}: ${filePath} ` +
          `[iteration ${parseIteration}]${retryLabel}${
            UPLOAD_TARGETS.length > 1 ? ` via ${targetHost}` : ""
          }`
      );

      try {
        attemptFingerprint = await getFileFingerprint(filePath);
        const res = await uploadReplay(filePath, {
          parseIteration,
          isFinal,
          uploadUrl: target.uploadUrl,
        });
        const detail = formatResponseBody(res.data);

        rememberWorkingUploadTarget(target);

        if (isFinal || detail.toLowerCase().includes("already parsed as final")) {
          entry.lastFinalUploadedFingerprint = attemptFingerprint;
          entry.lastFinalUploadAt = Date.now();
        } else {
          entry.lastLiveUploadedFingerprint = attemptFingerprint;
          entry.liveIteration = parseIteration;
          entry.lastLiveUploadAt = Date.now();
        }

        const changedDuringUpload = await syncEntryAfterUpload(filePath, entry, attemptFingerprint);

        console.log(
          `Uploaded (${res.status}): ${path.basename(filePath)}${detail ? ` - ${detail}` : ""}`
        );

        if (changedDuringUpload && shouldLogReplayGrowthNotice(entry, isFinal)) {
          console.log(
            `Replay is still growing during ${
              isFinal ? "final" : "live"
            } upload, watcher will wait for quiet replay bytes before the next pass.`
          );
        }

        return true;
      } catch (err) {
        const responseDetail = formatResponseBody(err?.response?.data);
        const prefix = isFinal ? "Final upload failed" : "Live upload failed";
        console.error(`${prefix} for ${path.basename(filePath)}:`, err.message);

        if (err.response) {
          console.error("Server response:", err.response.status, err.response.data);
        }

        if (isNetworkUploadError(err) && targetIndex < targetSequence.length - 1) {
          const nextTarget = targetSequence[targetIndex + 1];
          console.warn(
            `Upload target ${targetHost} is unavailable. Trying ${new URL(nextTarget.uploadUrl).host} next.`
          );
          continue;
        }

        if (!isRetryableUploadError(err) || attempt >= maxAttempts - 1) {
          return false;
        }

        const delayMs = getRetryDelayMs(attempt + 1);
        console.warn(
          `Retrying ${path.basename(filePath)} in ${Math.round(delayMs / 1000)}s ` +
            `(attempt ${attempt + 1}/${MAX_UPLOAD_RETRIES}) because ${responseDetail || err.message}`
        );

        if (isReplayFinalizingError(err)) {
          await waitForReplayProgress(filePath, attemptFingerprint, delayMs);
        } else {
          await sleep(delayMs);
        }

        break;
      }
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

      const now = Date.now();
      let fingerprint;

      try {
        fingerprint = await getFileFingerprint(filePath);
      } catch (err) {
        console.error(`Unable to inspect ${path.basename(filePath)}:`, err.message);
        return;
      }

      if (
        fingerprint === entry.lastFinalUploadedFingerprint &&
        fingerprint === entry.lastObservedFingerprint &&
        entry.lastFinalUploadAt > 0 &&
        now - entry.lastFinalUploadAt >= FINAL_SETTLE_WINDOW_MS
      ) {
        return;
      }

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

        if (!entry.lastFinalUploadedFingerprint && readyForLiveUpload) {
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
          continue;
        }
      }

      await sleep(STABLE_CHECK_INTERVAL_MS);
    }
  } finally {
    entry.monitoring = false;
  }
}

async function onFileDetected(filePath) {
  void monitorReplayFile(filePath).catch((err) => {
    console.error(`Replay monitor crashed for ${path.basename(filePath)}:`, err);
  });
}

function startWatching() {
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`Replay directory does not exist: ${WATCH_DIR}`);
    console.error("Set AOE2_WATCH_DIR in .env to your SaveGame folder and restart.");
    return null;
  }

  console.log(`Watching directory: ${WATCH_DIR}`);
  console.log(`Upload endpoints: ${UPLOAD_TARGETS.map((target) => target.uploadUrl).join(" -> ")}`);
  console.log(`Watcher UID: ${WATCHER_UID}`);

  // Important: do NOT use awaitWriteFinish here.
  // AoE replay files are written continuously during the match, and delaying
  // add/change events until the file "settles" makes the watcher notice the
  // replay far too late. The monitor loop below already handles byte floors,
  // retry timing, quiet periods, and final-settle logic.
  const watcher = chokidar.watch(WATCH_DIR, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
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