const chokidar = require("chokidar");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

let activeWatcher = null;
let activeUploadState = new Map();
let activePreferredUploadTargetBaseUrl = null;
let activeLogger = (message, level = "info") => {
  const method =
    level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](message);
};

function log(message, level = "info") {
  activeLogger(message, level);
}

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

function buildRuntimeConfig(config = {}) {
  const defaultApiBaseUrl = "https://api-prodn.aoe2hdbets.com";

  const apiBaseUrl = normalizeBaseUrl(
    config.apiBaseUrl || process.env.AOE2_API_BASE_URL || defaultApiBaseUrl
  );

  const defaultFallbackApiBaseUrl =
    apiBaseUrl === defaultApiBaseUrl ? "https://aoe2hdbets.com" : "";

  const apiFallbackBaseUrl = normalizeBaseUrl(
    config.apiFallbackBaseUrl ||
      process.env.AOE2_API_FALLBACK_BASE_URL ||
      defaultFallbackApiBaseUrl
  );

  const uploadTargets = Array.from(
    new Map(
      [apiBaseUrl, apiFallbackBaseUrl]
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

  return {
    watchDir: config.watchDir || process.env.AOE2_WATCH_DIR || getDefaultReplayDir(),
    uploadApiKey:
      (config.uploadApiKey || process.env.AOE2_UPLOAD_API_KEY || "").trim(),
    uploadTargets,
    watchExtensions: new Set([".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"]),
    maxUploadRetries: Number(process.env.AOE2_UPLOAD_RETRY_ATTEMPTS || 4),
    retryBaseDelayMs: Number(process.env.AOE2_UPLOAD_RETRY_BASE_DELAY_MS || 4000),
    retryPollMs: Number(process.env.AOE2_UPLOAD_RETRY_POLL_MS || 1000),
    stableCheckIntervalMs: Number(process.env.AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS || 3000),
    quietPeriodMs: Number(process.env.AOE2_UPLOAD_QUIET_PERIOD_MS || 30000),
    initialLiveDelayMs: Number(process.env.AOE2_INITIAL_LIVE_DELAY_MS || 3000),
    initialLiveRetryCooldownMs: Number(
      process.env.AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS || 10000
    ),
    liveUploadCooldownMs: Number(process.env.AOE2_LIVE_UPLOAD_COOLDOWN_MS || 45000),
    finalSettleWindowMs: Number(process.env.AOE2_FINAL_SETTLE_WINDOW_MS || 90000),
    firstBytesTimeoutMs: Number(process.env.AOE2_FIRST_BYTES_TIMEOUT_MS || 30000),
    firstBytesPollMs: Number(process.env.AOE2_FIRST_BYTES_POLL_MS || 1000),
    replayProgressLogIntervalMs: Number(
      process.env.AOE2_REPLAY_PROGRESS_LOG_INTERVAL_MS || 180000
    ),
    minReplayBytes: Number(process.env.AOE2_MIN_REPLAY_BYTES || 131072),
    watcherUid:
      process.env.WATCHER_USER_UID ||
      `watcher-${crypto
        .createHash("sha1")
        .update(os.hostname())
        .digest("hex")
        .slice(0, 12)}`,
  };
}

function getUploadTargetsForAttempt(runtimeConfig) {
  const preferred = runtimeConfig.uploadTargets.find(
    (target) => target.baseUrl === activePreferredUploadTargetBaseUrl
  );
  const remaining = runtimeConfig.uploadTargets.filter(
    (target) => target.baseUrl !== activePreferredUploadTargetBaseUrl
  );

  return preferred ? [preferred, ...remaining] : [...runtimeConfig.uploadTargets];
}

function rememberWorkingUploadTarget(target) {
  if (target?.baseUrl) {
    activePreferredUploadTargetBaseUrl = target.baseUrl;
  }
}

function getRetryDelayMsFactory(runtimeConfig, attempt) {
  return Math.min(
    runtimeConfig.retryBaseDelayMs * Math.max(1, 2 ** Math.max(0, attempt - 1)),
    30000
  );
}

async function getFileFingerprint(filePath) {
  const stats = await fs.promises.stat(filePath);
  return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
}

function getStateEntry(filePath) {
  let entry = activeUploadState.get(filePath);
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
    activeUploadState.set(filePath, entry);
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

function shouldHandle(filePath, runtimeConfig) {
  const ext = path.extname(filePath).toLowerCase();
  if (!runtimeConfig.watchExtensions.has(ext)) return false;
  if (filePath.includes("Out of Sync")) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFirstBytes(filePath, runtimeConfig) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= runtimeConfig.firstBytesTimeoutMs) {
    if (!fs.existsSync(filePath)) {
      log(`Replay disappeared before first parse: ${path.basename(filePath)}`, "warn");
      return false;
    }

    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.size >= runtimeConfig.minReplayBytes) {
        return true;
      }
    } catch (err) {
      log(
        `Unable to inspect ${path.basename(filePath)} before live parse: ${err.message}`,
        "warn"
      );
      return false;
    }

    await sleep(runtimeConfig.firstBytesPollMs);
  }

  log(
    `Replay never reached minimum parseable size (${runtimeConfig.minReplayBytes} bytes): ${path.basename(
      filePath
    )}`,
    "warn"
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
    const sleepMs = Math.min(1000, Math.max(1, deadline - Date.now()));
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
    log(`Unable to recheck ${path.basename(filePath)} after upload: ${err.message}`, "warn");
  }

  return false;
}

function shouldLogReplayGrowthNotice(entry, runtimeConfig, isFinal) {
  if (isFinal) {
    entry.lastReplayGrowthNoticeAt = Date.now();
    return true;
  }

  const now = Date.now();
  if (
    entry.lastReplayGrowthNoticeAt === 0 ||
    now - entry.lastReplayGrowthNoticeAt >= runtimeConfig.replayProgressLogIntervalMs
  ) {
    entry.lastReplayGrowthNoticeAt = now;
    return true;
  }

  return false;
}

async function uploadReplay(filePath, runtimeConfig, { parseIteration = 1, isFinal = true, uploadUrl } = {}) {
  const replayBuffer = await fs.promises.readFile(filePath);

  const form = new FormData();
  form.append("file", replayBuffer, {
    filename: path.basename(filePath),
    contentType: "application/octet-stream",
    knownLength: replayBuffer.length,
  });

  const headers = {
    ...form.getHeaders(),
    "x-user-uid": runtimeConfig.watcherUid,
    "x-parse-iteration": String(parseIteration),
    "x-is-final": isFinal ? "true" : "false",
    "x-parse-source": isFinal ? "watcher_final" : "watcher_live",
    "x-parse-reason": isFinal ? "watcher_final_submission" : "watcher_live_iteration",
  };

  if (runtimeConfig.uploadApiKey) {
    headers["x-api-key"] = runtimeConfig.uploadApiKey;
  }

  try {
    headers["Content-Length"] = await getFormLength(form);
  } catch (err) {
    log(`Unable to precompute upload size for ${path.basename(filePath)}: ${err.message}`, "warn");
  }

  return axios.post(uploadUrl, form, {
    timeout: 60000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers,
  });
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

async function uploadReplayWithRetry(filePath, runtimeConfig, entry, { fingerprint, parseIteration, isFinal }) {
  const maxAttempts = runtimeConfig.maxUploadRetries + 1;
  let attemptFingerprint = fingerprint;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryLabel = attempt > 0 ? ` (retry ${attempt}/${runtimeConfig.maxUploadRetries})` : "";
    const targetSequence = getUploadTargetsForAttempt(runtimeConfig);

    for (let targetIndex = 0; targetIndex < targetSequence.length; targetIndex += 1) {
      const target = targetSequence[targetIndex];
      const targetHost = new URL(target.uploadUrl).host;

      log(
        `${isFinal ? "Uploading final replay" : "Uploading live replay"}: ${filePath} ` +
          `[iteration ${parseIteration}]${retryLabel}${
            runtimeConfig.uploadTargets.length > 1 ? ` via ${targetHost}` : ""
          }`
      );

      try {
        attemptFingerprint = await getFileFingerprint(filePath);
        const res = await uploadReplay(filePath, runtimeConfig, {
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

        log(`Uploaded (${res.status}): ${path.basename(filePath)}${detail ? ` - ${detail}` : ""}`);

        if (changedDuringUpload && shouldLogReplayGrowthNotice(entry, runtimeConfig, isFinal)) {
          log(
            `Replay is still growing during ${
              isFinal ? "final" : "live"
            } upload, watcher will wait for quiet replay bytes before the next pass.`
          );
        }

        return true;
      } catch (err) {
        const responseDetail = formatResponseBody(err?.response?.data);
        const prefix = isFinal ? "Final upload failed" : "Live upload failed";

        log(`${prefix} for ${path.basename(filePath)}: ${err.message}`, "error");

        if (err.response) {
          log(
            `Server response: ${err.response.status} ${JSON.stringify(err.response.data)}`,
            "error"
          );
        }

        if (isNetworkUploadError(err) && targetIndex < targetSequence.length - 1) {
          const nextTarget = targetSequence[targetIndex + 1];
          log(
            `Upload target ${targetHost} is unavailable. Trying ${new URL(nextTarget.uploadUrl).host} next.`,
            "warn"
          );
          continue;
        }

        if (!isRetryableUploadError(err) || attempt >= maxAttempts - 1) {
          return false;
        }

        const delayMs = getRetryDelayMsFactory(runtimeConfig, attempt + 1);
        log(
          `Retrying ${path.basename(filePath)} in ${Math.round(delayMs / 1000)}s ` +
            `(attempt ${attempt + 1}/${runtimeConfig.maxUploadRetries}) because ${
              responseDetail || err.message
            }`,
          "warn"
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

async function monitorReplayFile(filePath, runtimeConfig) {
  if (!shouldHandle(filePath, runtimeConfig)) return;

  const entry = getStateEntry(filePath);
  if (entry.monitoring) {
    return;
  }

  entry.monitoring = true;

  try {
    if (!(await waitForFirstBytes(filePath, runtimeConfig))) {
      return;
    }

    if (runtimeConfig.initialLiveDelayMs > 0) {
      await sleep(runtimeConfig.initialLiveDelayMs);
    }

    while (true) {
      if (!fs.existsSync(filePath)) {
        log(`Replay removed before final upload: ${path.basename(filePath)}`, "warn");
        return;
      }

      const now = Date.now();
      let fingerprint;

      try {
        fingerprint = await getFileFingerprint(filePath);
      } catch (err) {
        log(`Unable to inspect ${path.basename(filePath)}: ${err.message}`, "error");
        return;
      }

      if (
        fingerprint === entry.lastFinalUploadedFingerprint &&
        fingerprint === entry.lastObservedFingerprint &&
        entry.lastFinalUploadAt > 0 &&
        now - entry.lastFinalUploadAt >= runtimeConfig.finalSettleWindowMs
      ) {
        return;
      }

      const changed = fingerprint !== entry.lastObservedFingerprint;

      if (changed) {
        entry.lastObservedFingerprint = fingerprint;
        entry.lastChangeAt = now;

        const liveCooldownMs =
          entry.liveIteration === 0
            ? runtimeConfig.initialLiveRetryCooldownMs
            : runtimeConfig.liveUploadCooldownMs;
        const lastLiveAnchorAt =
          entry.liveIteration === 0 ? entry.lastLiveAttemptAt : entry.lastLiveUploadAt;

        const readyForLiveUpload =
          fingerprint !== entry.lastLiveUploadedFingerprint &&
          (lastLiveAnchorAt === 0 || now - lastLiveAnchorAt >= liveCooldownMs);

        if (!entry.lastFinalUploadedFingerprint && readyForLiveUpload) {
          const nextIteration = entry.liveIteration + 1;
          entry.lastLiveAttemptAt = now;

          await uploadReplayWithRetry(filePath, runtimeConfig, entry, {
            fingerprint,
            parseIteration: nextIteration,
            isFinal: false,
          });
        }
      } else if (
        fingerprint !== entry.lastFinalUploadedFingerprint &&
        entry.lastChangeAt > 0 &&
        now - entry.lastChangeAt >= runtimeConfig.quietPeriodMs
      ) {
        const nextIteration = Math.max(1, entry.liveIteration + 1);
        const stored = await uploadReplayWithRetry(filePath, runtimeConfig, entry, {
          fingerprint,
          parseIteration: nextIteration,
          isFinal: true,
        });

        if (stored) {
          continue;
        }
      }

      await sleep(runtimeConfig.stableCheckIntervalMs);
    }
  } finally {
    entry.monitoring = false;
  }
}

async function onFileDetected(filePath, runtimeConfig) {
  void monitorReplayFile(filePath, runtimeConfig).catch((err) => {
    log(`Replay monitor crashed for ${path.basename(filePath)}: ${err.message || err}`, "error");
  });
}

function stopWatching() {
  if (activeWatcher) {
    try {
      activeWatcher.close();
    } catch (error) {
      log(`Failed closing watcher: ${error.message}`, "error");
    }
  }

  activeWatcher = null;
  activeUploadState = new Map();
  activePreferredUploadTargetBaseUrl = null;
}

function startWatching(config = {}, hooks = {}) {
  stopWatching();

  if (typeof hooks.onLog === "function") {
    activeLogger = hooks.onLog;
  } else {
    activeLogger = (message, level = "info") => {
      const method =
        level === "error" ? "error" : level === "warn" ? "warn" : "log";
      console[method](message);
    };
  }

  const runtimeConfig = buildRuntimeConfig(config);
  activePreferredUploadTargetBaseUrl = runtimeConfig.uploadTargets[0]?.baseUrl || null;

  if (!runtimeConfig.watchDir || !fs.existsSync(runtimeConfig.watchDir)) {
    log(`Replay directory does not exist: ${runtimeConfig.watchDir || "(empty)"}`, "error");
    log("Choose a valid SaveGame folder and restart watching.", "error");
    return null;
  }

  if (!runtimeConfig.uploadApiKey) {
    log("Upload API key is missing. Set it in Watcher settings before starting.", "error");
    return null;
  }

  log(`Watching directory: ${runtimeConfig.watchDir}`);
  log(
    `Upload endpoints: ${runtimeConfig.uploadTargets
      .map((target) => target.uploadUrl)
      .join(" -> ")}`
  );
  log(`Watcher UID: ${runtimeConfig.watcherUid}`);

  activeWatcher = chokidar.watch(runtimeConfig.watchDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
  });

  activeWatcher.on("add", (filePath) => onFileDetected(filePath, runtimeConfig));
  activeWatcher.on("change", (filePath) => onFileDetected(filePath, runtimeConfig));
  activeWatcher.on("error", (err) => log(`Watcher error: ${err.message}`, "error"));

  return activeWatcher;
}

module.exports = {
  getDefaultReplayDir,
  getRetryDelayMs: (attempt, config = {}) => getRetryDelayMsFactory(buildRuntimeConfig(config), attempt),
  isRetryableUploadError,
  monitorReplayFile,
  startWatching,
  stopWatching,
};