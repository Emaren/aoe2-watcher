const chokidar = require("chokidar");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

const SUPPORTED_REPLAY_EXTENSIONS = [".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"];
const IMPORT_STABILITY_CHECK_MS = 1200;
const IMPORT_ITEM_LIMIT = 75;

let activeWatcher = null;
let activeUploadState = new Map();
let activePreferredUploadTargetBaseUrl = null;
let activeLogger = defaultLogger;
let activeEventHook = () => {};

function defaultLogger(message, level = "info") {
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](message);
}

function setRuntimeHooks(hooks = {}) {
  if (typeof hooks.onLog === "function") {
    activeLogger = hooks.onLog;
  }

  if (typeof hooks.onEvent === "function") {
    activeEventHook = hooks.onEvent;
  }
}

function log(message, level = "info") {
  activeLogger(message, level);
}

function emitRuntimeEvent(type, payload = {}) {
  try {
    activeEventHook({
      type,
      occurredAt: new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    defaultLogger(`Failed to emit watcher runtime event "${type}": ${error.message}`, "warn");
  }
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
    uploadApiKey: (config.uploadApiKey || process.env.AOE2_UPLOAD_API_KEY || "").trim(),
    uploadTargets,
    watchExtensions: new Set(SUPPORTED_REPLAY_EXTENSIONS),
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

function getRuntimeValidationError(runtimeConfig) {
  if (!runtimeConfig.watchDir || !fs.existsSync(runtimeConfig.watchDir)) {
    return `Replay directory does not exist: ${runtimeConfig.watchDir || "(empty)"}`;
  }

  if (!runtimeConfig.uploadApiKey) {
    return "Watcher key is missing. Paste it in Watcher settings before starting.";
  }

  return null;
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

async function getReplayContentHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function getStateEntry(filePath) {
  let entry = activeUploadState.get(filePath);
  if (!entry) {
    entry = {
      monitoring: false,
      importing: false,
      lastObservedFingerprint: null,
      lastChangeAt: 0,
      lastLiveAttemptAt: 0,
      lastLiveUploadAt: 0,
      lastLiveUploadedFingerprint: null,
      lastFinalUploadedFingerprint: null,
      lastFinalReplayHash: null,
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

function getSupportedReplayExtensions() {
  return [...SUPPORTED_REPLAY_EXTENSIONS];
}

function classifyUploadResult(detail = "") {
  const normalized = detail.toLowerCase();

  if (normalized.includes("already parsed as final") || normalized.includes("already stored")) {
    return "duplicate";
  }

  if (normalized.includes("refreshed")) {
    return "refreshed";
  }

  if (normalized.includes("placeholder")) {
    return "placeholder";
  }

  return "uploaded";
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

async function getStableImportFingerprint(filePath) {
  if (!fs.existsSync(filePath)) {
    return { stable: false, reason: "missing" };
  }

  try {
    const firstFingerprint = await getFileFingerprint(filePath);
    await sleep(IMPORT_STABILITY_CHECK_MS);

    if (!fs.existsSync(filePath)) {
      return { stable: false, reason: "missing" };
    }

    const secondFingerprint = await getFileFingerprint(filePath);
    if (firstFingerprint !== secondFingerprint) {
      return { stable: false, reason: "changing" };
    }

    return {
      stable: true,
      fingerprint: secondFingerprint,
    };
  } catch (error) {
    return {
      stable: false,
      reason: "inspect_failed",
      detail: error.message || "Unable to inspect file.",
    };
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

function hasSettledReplayFingerprint(entry, fingerprint, runtimeConfig, now = Date.now()) {
  return Boolean(
    fingerprint &&
      fingerprint === entry.lastFinalUploadedFingerprint &&
      fingerprint === entry.lastObservedFingerprint &&
      entry.lastFinalUploadAt > 0 &&
      now - entry.lastFinalUploadAt >= runtimeConfig.finalSettleWindowMs
  );
}

async function resolveFinalReplayShortCircuit(
  filePath,
  entry,
  runtimeConfig,
  { fingerprint = null, now = Date.now() } = {}
) {
  if (!entry.lastFinalUploadedFingerprint && !entry.lastFinalReplayHash) {
    return null;
  }

  let nextFingerprint = fingerprint;
  if (!nextFingerprint) {
    try {
      nextFingerprint = await getFileFingerprint(filePath);
    } catch {
      return null;
    }
  }

  if (hasSettledReplayFingerprint(entry, nextFingerprint, runtimeConfig, now)) {
    return {
      reason: "settled_fingerprint",
      fingerprint: nextFingerprint,
    };
  }

  if (!entry.lastFinalReplayHash) {
    return null;
  }

  let contentHash;
  try {
    contentHash = await getReplayContentHash(filePath);
  } catch (error) {
    log(
      `Unable to hash ${path.basename(filePath)} while checking final replay state: ${error.message}`,
      "warn"
    );
    return null;
  }

  if (contentHash !== entry.lastFinalReplayHash) {
    return null;
  }

  entry.lastObservedFingerprint = nextFingerprint;
  entry.lastFinalUploadedFingerprint = nextFingerprint;
  entry.lastChangeAt = now;

  return {
    reason: "settled_replay_hash",
    fingerprint: nextFingerprint,
    replayHash: contentHash,
  };
}

async function uploadReplay(
  filePath,
  runtimeConfig,
  { parseIteration = 1, isFinal = true, uploadUrl } = {}
) {
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

async function uploadReplayWithRetry(
  filePath,
  runtimeConfig,
  entry,
  { fingerprint, parseIteration, isFinal }
) {
  const maxAttempts = runtimeConfig.maxUploadRetries + 1;
  let attemptFingerprint = fingerprint;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryLabel =
      attempt > 0 ? ` (retry ${attempt}/${runtimeConfig.maxUploadRetries})` : "";
    const targetSequence = getUploadTargetsForAttempt(runtimeConfig);

    for (let targetIndex = 0; targetIndex < targetSequence.length; targetIndex += 1) {
      const target = targetSequence[targetIndex];
      const targetHost = new URL(target.uploadUrl).host;

      emitRuntimeEvent("upload-start", {
        filePath,
        fileName: path.basename(filePath),
        isFinal,
        parseIteration,
        attempt,
        maxRetryCount: runtimeConfig.maxUploadRetries,
        uploadHost: targetHost,
      });

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
        const resultType = classifyUploadResult(detail);
        const replayHash =
          typeof res?.data?.replay_hash === "string" && res.data.replay_hash.trim()
            ? res.data.replay_hash.trim()
            : null;

        rememberWorkingUploadTarget(target);

        if (isFinal || detail.toLowerCase().includes("already parsed as final")) {
          entry.lastFinalUploadedFingerprint = attemptFingerprint;
          entry.lastFinalUploadAt = Date.now();
          if (replayHash) {
            entry.lastFinalReplayHash = replayHash;
          }
        } else {
          entry.lastLiveUploadedFingerprint = attemptFingerprint;
          entry.liveIteration = parseIteration;
          entry.lastLiveUploadAt = Date.now();
        }

        const changedDuringUpload = await syncEntryAfterUpload(
          filePath,
          entry,
          attemptFingerprint
        );

        log(`Uploaded (${res.status}): ${path.basename(filePath)}${detail ? ` - ${detail}` : ""}`);

        emitRuntimeEvent("upload-success", {
          filePath,
          fileName: path.basename(filePath),
          isFinal,
          parseIteration,
          resultType,
          responseStatus: res.status,
          detail,
        });

        if (changedDuringUpload && shouldLogReplayGrowthNotice(entry, runtimeConfig, isFinal)) {
          log(
            `Replay is still growing during ${
              isFinal ? "final" : "live"
            } upload, watcher will wait for quiet replay bytes before the next pass.`
          );
        }

        return {
          ok: true,
          changedDuringUpload,
          detail,
          resultType,
          responseData: res.data,
          responseStatus: res.status,
        };
      } catch (err) {
        const responseDetail = formatResponseBody(err?.response?.data);
        const prefix = isFinal ? "Final upload failed" : "Live upload failed";
        const errorMessage = responseDetail || err.message;

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
          emitRuntimeEvent("upload-failure", {
            filePath,
            fileName: path.basename(filePath),
            isFinal,
            parseIteration,
            errorMessage,
            responseStatus: err?.response?.status || null,
          });
          return {
            ok: false,
            errorMessage,
            responseStatus: err?.response?.status || null,
          };
        }

        const delayMs = getRetryDelayMsFactory(runtimeConfig, attempt + 1);
        log(
          `Retrying ${path.basename(filePath)} in ${Math.round(delayMs / 1000)}s ` +
            `(attempt ${attempt + 1}/${runtimeConfig.maxUploadRetries}) because ${
              errorMessage || err.message
            }`,
          "warn"
        );

        emitRuntimeEvent("upload-retry", {
          filePath,
          fileName: path.basename(filePath),
          isFinal,
          parseIteration,
          errorMessage,
          retryInMs: delayMs,
          nextRetryAttempt: attempt + 1,
          maxRetryCount: runtimeConfig.maxUploadRetries,
          responseStatus: err?.response?.status || null,
        });

        if (isReplayFinalizingError(err)) {
          await waitForReplayProgress(filePath, attemptFingerprint, delayMs);
        } else {
          await sleep(delayMs);
        }

        break;
      }
    }
  }

  return {
    ok: false,
    errorMessage: "Upload failed after all retries.",
  };
}

async function monitorReplayFile(filePath, runtimeConfig) {
  if (!shouldHandle(filePath, runtimeConfig)) {
    log(`Ignoring non-replay file: ${path.basename(filePath)}`, "warn");
    return;
  }

  const entry = getStateEntry(filePath);
  if (entry.monitoring) {
    log(`Skipping duplicate monitor for ${path.basename(filePath)} because it is already active.`);
    return;
  }

  if (entry.importing) {
    log(`Skipping live monitor for ${path.basename(filePath)} because it is importing already.`, "warn");
    return;
  }

  const finalReplayShortCircuit = await resolveFinalReplayShortCircuit(
    filePath,
    entry,
    runtimeConfig
  );
  if (finalReplayShortCircuit) {
    log(
      `Skipping monitor for ${path.basename(filePath)} because replay already matches final upload state (${finalReplayShortCircuit.reason}).`
    );
    emitRuntimeEvent("monitor-skip-final", {
      filePath,
      fileName: path.basename(filePath),
      reason: finalReplayShortCircuit.reason,
      replayHash: finalReplayShortCircuit.replayHash || entry.lastFinalReplayHash || null,
    });
    return;
  }

  entry.monitoring = true;
  emitRuntimeEvent("monitor-start", {
    filePath,
    fileName: path.basename(filePath),
  });
  log(`Starting monitor loop for ${path.basename(filePath)}.`);

  try {
    if (!(await waitForFirstBytes(filePath, runtimeConfig))) {
      log(
        `Stopping monitor for ${path.basename(filePath)} before upload because byte floor was not reached.`,
        "warn"
      );
      return;
    }

    if (runtimeConfig.initialLiveDelayMs > 0) {
      log(
        `Waiting ${Math.round(runtimeConfig.initialLiveDelayMs / 1000)}s before first live upload for ${path.basename(
          filePath
        )}.`
      );
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
        emitRuntimeEvent("watcher-error", {
          filePath,
          fileName: path.basename(filePath),
          detail: err.message,
        });
        return;
      }

      if (hasSettledReplayFingerprint(entry, fingerprint, runtimeConfig, now)) {
        log(`Monitor loop complete for ${path.basename(filePath)}. Replay is fully settled.`);
        return;
      }

      const changed = fingerprint !== entry.lastObservedFingerprint;

      if (changed) {
        entry.lastObservedFingerprint = fingerprint;
        entry.lastChangeAt = now;

        log(`Observed replay change for ${path.basename(filePath)} with fingerprint ${fingerprint}.`);

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
        } else if (!entry.lastFinalUploadedFingerprint) {
          log(
            `Live upload cooldown still active for ${path.basename(filePath)}. Waiting for next eligible pass.`
          );
        }
      } else if (
        fingerprint !== entry.lastFinalUploadedFingerprint &&
        entry.lastChangeAt > 0 &&
        now - entry.lastChangeAt >= runtimeConfig.quietPeriodMs
      ) {
        log(
          `Quiet period reached for ${path.basename(filePath)} after ${Math.round(
            runtimeConfig.quietPeriodMs / 1000
          )}s. Attempting final upload.`
        );

        const nextIteration = Math.max(1, entry.liveIteration + 1);
        const stored = await uploadReplayWithRetry(filePath, runtimeConfig, entry, {
          fingerprint,
          parseIteration: nextIteration,
          isFinal: true,
        });

        if (stored.ok) {
          continue;
        }
      }

      await sleep(runtimeConfig.stableCheckIntervalMs);
    }
  } finally {
    entry.monitoring = false;
    emitRuntimeEvent("monitor-stop", {
      filePath,
      fileName: path.basename(filePath),
    });
    log(`Stopped monitor loop for ${path.basename(filePath)}.`);
  }
}

async function onFileDetected(eventType, filePath, runtimeConfig) {
  if (!shouldHandle(filePath, runtimeConfig)) {
    return;
  }

  const entry = getStateEntry(filePath);
  const fileName = path.basename(filePath);

  if (entry.monitoring) {
    emitRuntimeEvent("replay-detected-ignored", {
      filePath,
      fileName,
      eventType,
      reason: "monitoring",
    });
    return;
  }

  if (entry.importing) {
    emitRuntimeEvent("replay-detected-ignored", {
      filePath,
      fileName,
      eventType,
      reason: "importing",
    });
    return;
  }

  const finalReplayShortCircuit = await resolveFinalReplayShortCircuit(
    filePath,
    entry,
    runtimeConfig
  );
  if (finalReplayShortCircuit) {
    log(
      `Ignoring ${eventType} event for ${fileName} because replay already matches final upload state (${finalReplayShortCircuit.reason}).`
    );
    emitRuntimeEvent("replay-detected-ignored", {
      filePath,
      fileName,
      eventType,
      reason: finalReplayShortCircuit.reason,
      replayHash: finalReplayShortCircuit.replayHash || entry.lastFinalReplayHash || null,
    });
    return;
  }

  log(`Detected ${eventType} event: ${fileName}`);
  emitRuntimeEvent("replay-detected", {
    filePath,
    fileName,
    eventType,
  });
  void monitorReplayFile(filePath, runtimeConfig).catch((err) => {
    log(`Replay monitor crashed for ${fileName}: ${err.message || err}`, "error");
    emitRuntimeEvent("watcher-error", {
      filePath,
      fileName,
      detail: err.message || String(err),
    });
  });
}

function createImportItem(filePath, status, detail) {
  return {
    filePath,
    fileName: path.basename(filePath),
    status,
    detail,
  };
}

function pushImportItem(list, item) {
  list.unshift(item);
  if (list.length > IMPORT_ITEM_LIMIT) {
    list.length = IMPORT_ITEM_LIMIT;
  }
}

function cloneImportState(state) {
  return JSON.parse(JSON.stringify(state));
}

function emitImportProgress(state, hooks) {
  if (typeof hooks.onProgress === "function") {
    hooks.onProgress(cloneImportState(state));
  }
}

function updateImportPercent(state) {
  if (state.queued <= 0) {
    state.percent = state.phase.startsWith("complete") ? 100 : 0;
    return;
  }

  const finished = state.uploaded + state.failed + state.skipped;
  state.percent = Math.max(0, Math.min(100, Math.round((finished / state.queued) * 100)));
}

function buildImportSummaryText(state) {
  return `Imported ${state.uploaded}, skipped ${state.skipped}, failed ${state.failed}.`;
}

async function listImportCandidates(runtimeConfig, filePaths = null) {
  const supportedFiles = [];
  const skippedAtScan = [];
  let unsupported = 0;

  if (Array.isArray(filePaths)) {
    const seen = new Set();

    for (const rawPath of filePaths) {
      const filePath = String(rawPath || "").trim();
      if (!filePath || seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);

      if (!fs.existsSync(filePath)) {
        skippedAtScan.push(createImportItem(filePath, "skipped", "File is no longer on disk."));
        continue;
      }

      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        skippedAtScan.push(createImportItem(filePath, "skipped", "Not a replay file."));
        continue;
      }

      if (!shouldHandle(filePath, runtimeConfig)) {
        skippedAtScan.push(
          createImportItem(filePath, "skipped", "Not a supported replay extension for this watcher.")
        );
        continue;
      }

      supportedFiles.push({
        filePath,
        fileName: path.basename(filePath),
        mtimeMs: stats.mtimeMs,
      });
    }

    return {
      supportedFiles,
      unsupported,
      skippedAtScan,
    };
  }

  const entries = await fs.promises.readdir(runtimeConfig.watchDir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(runtimeConfig.watchDir, entry.name);
    if (!shouldHandle(filePath, runtimeConfig)) {
      unsupported += 1;
      continue;
    }

    const stats = await fs.promises.stat(filePath);
    supportedFiles.push({
      filePath,
      fileName: entry.name,
      mtimeMs: stats.mtimeMs,
    });
  }

  supportedFiles.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return left.mtimeMs - right.mtimeMs;
    }
    return left.fileName.localeCompare(right.fileName);
  });

  return {
    supportedFiles,
    unsupported,
    skippedAtScan,
  };
}

async function importHistoricalReplays(config = {}, options = {}, hooks = {}) {
  setRuntimeHooks(hooks);

  const runtimeConfig = buildRuntimeConfig(config);
  const validationError = getRuntimeValidationError(runtimeConfig);
  if (validationError) {
    throw new Error(validationError);
  }

  const state = {
    isRunning: true,
    source: options.source || (Array.isArray(options.filePaths) ? "retry" : "scan"),
    phase: "scanning",
    startedAt: new Date().toISOString(),
    completedAt: null,
    percent: 0,
    found: 0,
    queued: 0,
    skipped: 0,
    uploaded: 0,
    failed: 0,
    unsupported: 0,
    currentFile: "",
    currentIndex: 0,
    failedItems: [],
    skippedItems: [],
    recentItems: [],
    summaryText: "",
  };

  emitImportProgress(state, hooks);

  const { supportedFiles, unsupported, skippedAtScan } = await listImportCandidates(
    runtimeConfig,
    options.filePaths || null
  );

  state.found = supportedFiles.length;
  state.unsupported = unsupported;

  const queue = [];
  for (const candidate of supportedFiles) {
    const entry = getStateEntry(candidate.filePath);
    if (entry.monitoring) {
      state.skipped += 1;
      pushImportItem(
        state.skippedItems,
        createImportItem(
          candidate.filePath,
          "skipped",
          "Already being watched live. Let the watcher finish the current replay."
        )
      );
      continue;
    }

    if (entry.importing) {
      state.skipped += 1;
      pushImportItem(
        state.skippedItems,
        createImportItem(candidate.filePath, "skipped", "Already queued for import in this session.")
      );
      continue;
    }

    queue.push(candidate);
  }

  for (const skippedItem of skippedAtScan) {
    state.skipped += 1;
    pushImportItem(state.skippedItems, skippedItem);
  }

  state.queued = queue.length;
  state.phase = queue.length > 0 ? "uploading" : "complete";
  updateImportPercent(state);
  emitImportProgress(state, hooks);

  if (queue.length === 0) {
    state.isRunning = false;
    state.completedAt = new Date().toISOString();
    state.summaryText =
      state.found === 0
        ? "No supported replay files were found in this folder."
        : buildImportSummaryText(state);
    emitImportProgress(state, hooks);
    return cloneImportState(state);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    const entry = getStateEntry(candidate.filePath);

    state.currentIndex = index + 1;
    state.currentFile = candidate.fileName;
    state.phase = "uploading";
    emitImportProgress(state, hooks);

    const stability = await getStableImportFingerprint(candidate.filePath);

    if (!stability.stable) {
      state.skipped += 1;
      const reason =
        stability.reason === "changing"
          ? "Replay is still changing on disk. Live watching will finish it."
          : stability.reason === "missing"
            ? "Replay disappeared before import started."
            : stability.detail || "Unable to inspect replay file.";
      pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", reason));
      pushImportItem(state.recentItems, createImportItem(candidate.filePath, "skipped", reason));
      updateImportPercent(state);
      emitImportProgress(state, hooks);
      continue;
    }

    if (entry.lastFinalUploadedFingerprint === stability.fingerprint) {
      state.skipped += 1;
      const detail = "Already imported in this app session.";
      pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", detail));
      pushImportItem(state.recentItems, createImportItem(candidate.filePath, "skipped", detail));
      updateImportPercent(state);
      emitImportProgress(state, hooks);
      continue;
    }

    entry.importing = true;
    try {
      const result = await uploadReplayWithRetry(candidate.filePath, runtimeConfig, entry, {
        fingerprint: stability.fingerprint,
        parseIteration: 1,
        isFinal: true,
      });

      if (!result.ok) {
        state.failed += 1;
        const detail = result.errorMessage || "Upload failed.";
        pushImportItem(state.failedItems, createImportItem(candidate.filePath, "failed", detail));
        pushImportItem(state.recentItems, createImportItem(candidate.filePath, "failed", detail));
      } else if (result.resultType === "duplicate") {
        state.skipped += 1;
        const detail = result.detail || "Replay already exists on AoE2HDBets.";
        pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", detail));
        pushImportItem(state.recentItems, createImportItem(candidate.filePath, "skipped", detail));
      } else {
        state.uploaded += 1;
        const detail =
          result.resultType === "refreshed"
            ? result.detail || "Replay refreshed with better final data."
            : result.detail || "Replay imported successfully.";
        pushImportItem(state.recentItems, createImportItem(candidate.filePath, "uploaded", detail));
      }
    } finally {
      entry.importing = false;
      state.currentFile = "";
      updateImportPercent(state);
      emitImportProgress(state, hooks);
    }
  }

  state.isRunning = false;
  state.phase = state.failed > 0 ? "complete_with_failures" : "complete";
  state.completedAt = new Date().toISOString();
  state.summaryText = buildImportSummaryText(state);
  updateImportPercent(state);
  emitImportProgress(state, hooks);

  return cloneImportState(state);
}

function stopWatching() {
  if (activeWatcher) {
    try {
      activeWatcher.close();
      log("Closed chokidar watcher handle.");
    } catch (error) {
      log(`Failed closing watcher: ${error.message}`, "error");
    }
  }

  activeWatcher = null;
  activeUploadState = new Map();
  activePreferredUploadTargetBaseUrl = null;
  emitRuntimeEvent("watching-stopped", {});
}

function startWatching(config = {}, hooks = {}) {
  stopWatching();
  setRuntimeHooks(hooks);

  const runtimeConfig = buildRuntimeConfig(config);
  const validationError = getRuntimeValidationError(runtimeConfig);
  activePreferredUploadTargetBaseUrl = runtimeConfig.uploadTargets[0]?.baseUrl || null;

  if (validationError) {
    log(validationError, "error");
    if (validationError.toLowerCase().includes("replay directory")) {
      log("Choose a valid SaveGame folder and restart watching.", "error");
    }
    emitRuntimeEvent("watcher-error", {
      detail: validationError,
    });
    return null;
  }

  log(`Watching directory: ${runtimeConfig.watchDir}`);
  log(
    `Upload endpoints: ${runtimeConfig.uploadTargets
      .map((target) => target.uploadUrl)
      .join(" -> ")}`
  );
  log(`Watcher UID: ${runtimeConfig.watcherUid}`);
  log(`Chokidar extensions: ${Array.from(runtimeConfig.watchExtensions).join(", ")}`);

  emitRuntimeEvent("watching-started", {
    watchDir: runtimeConfig.watchDir,
    uploadTargets: runtimeConfig.uploadTargets.map((target) => target.uploadUrl),
  });

  activeWatcher = chokidar.watch(runtimeConfig.watchDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
  });

  activeWatcher.on("ready", () => {
    log("Chokidar watcher is ready and listening for replay events.");
    emitRuntimeEvent("watcher-ready", {
      watchDir: runtimeConfig.watchDir,
    });
  });

  activeWatcher.on("add", (filePath) => onFileDetected("add", filePath, runtimeConfig));
  activeWatcher.on("change", (filePath) => onFileDetected("change", filePath, runtimeConfig));
  activeWatcher.on("error", (err) => {
    log(`Watcher error: ${err.message}`, "error");
    emitRuntimeEvent("watcher-error", {
      detail: err.message,
    });
  });

  return activeWatcher;
}

module.exports = {
  buildRuntimeConfig,
  classifyUploadResult,
  getDefaultReplayDir,
  getFileFingerprint,
  getRetryDelayMs: (attempt, config = {}) =>
    getRetryDelayMsFactory(buildRuntimeConfig(config), attempt),
  getReplayContentHash,
  getRuntimeValidationError,
  getSupportedReplayExtensions,
  importHistoricalReplays,
  isRetryableUploadError,
  monitorReplayFile,
  resolveFinalReplayShortCircuit,
  shouldHandle,
  startWatching,
  stopWatching,
};
