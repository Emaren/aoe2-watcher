const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

const SUPPORTED_REPLAY_EXTENSIONS = [".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"];
const IMPORT_STABILITY_CHECK_MS = 1200;
const IMPORT_ITEM_LIMIT = 75;
const IMPORT_SCAN_MAX_DEPTH = Math.max(
  0,
  Number.parseInt(process.env.AOE2_IMPORT_SCAN_DEPTH || "2", 10) || 0
);
const DEFAULT_LIVE_UPLOAD_COOLDOWN_MS = 30 * 1000;
const DEFAULT_FINAL_CANDIDATE_MIN_AGE_MS = 30 * 1000;
const DEFAULT_FINAL_CANDIDATE_COOLDOWN_MS = 45 * 1000;
const DEFAULT_FINAL_SETTLE_WINDOW_MS = 3 * 60 * 1000;
const DEFAULT_FINAL_QUIET_PERIOD_MS = 18 * 1000;
const RECENT_LIVE_CANDIDATE_MS = Number(
  process.env.AOE2_RECENT_LIVE_CANDIDATE_MS || 10 * 60 * 1000
);
const LIVE_CANDIDATE_GROWTH_CHECK_MS = Number(
  process.env.AOE2_LIVE_CANDIDATE_GROWTH_CHECK_MS || 1500
);
const DEFAULT_RECOVERY_SCAN_INTERVAL_MS = 10 * 1000;
const WATCHER_PROVENANCE_LIVE_MONITOR = "live_monitor";
const WATCHER_PROVENANCE_HISTORICAL_IMPORT = "historical_import";
const SETTLEMENT_STATE_VERSION = 1;
const SETTLEMENT_STATE_MAX_ENTRIES = 5000;
const SETTLEMENT_STATE_MAX_AGE_MS =
  90 * 24 * 60 * 60 * 1000;
const LEGACY_DOMAIN_MIGRATIONS = [
  ["https://api-prodn.aoe2hdbets.com", "https://api-prodn.aoe2war.com"],
  ["https://api.aoe2hdbets.com", "https://api-prodn.aoe2war.com"],
  ["https://www.aoe2hdbets.com", "https://www.aoe2war.com"],
  ["https://aoe2hdbets.com", "https://aoe2war.com"],
];

let activeWatcher = null;
let activeRecoveryScanTimer = null;
let activeRecoveryScanInFlight = false;
let activeUploadState = new Map();
let activeUploadKeys = new Set();
let activeSettlementStatePath = null;
let activePreferredUploadTargetBaseUrl = null;
let activeLogger = defaultLogger;
let activeEventHook = () => {};
let activeRuntimeStatus = createRuntimeStatus();

function createRuntimeStatus() {
  return {
    monitorAttached: false,
    monitorStartedAt: null,
    folderValid: false,
    folderKind: "unknown",
    folderLabel: null,
    lastFolderActivityAt: null,
    lastReplayDetectedAt: null,
    lastReplayUploadAt: null,
    lastReplayUploadStatus: null,
    activeReplay: false,
    activeReplayBasename: null,
    activeReplaySizeBytes: null,
    activeReplayLastChangedAt: null,
    uploadQueueLength: 0,
    repeatedUploadErrors: 0,
  };
}

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

function getUploadQueueKey(payload = {}) {
  const fileKey =
    payload.filePath ||
    payload.fileName ||
    "unknown";

  return `${fileKey}:${payload.isFinal ? "final" : "live"}`;
}

function emitRuntimeEvent(type, payload = {}) {
  const occurredAt = new Date().toISOString();
  if (type === "watching-started") {
    activeRuntimeStatus.monitorStartedAt = occurredAt;
  } else if (type === "watcher-ready") {
    activeRuntimeStatus.monitorAttached = true;
  } else if (type === "watching-stopped" || type === "watcher-error") {
    activeRuntimeStatus.monitorAttached = false;
  } else if (type === "replay-detected") {
    activeRuntimeStatus.lastFolderActivityAt = occurredAt;
    activeRuntimeStatus.lastReplayDetectedAt = occurredAt;
    activeRuntimeStatus.activeReplay = true;
    activeRuntimeStatus.activeReplayBasename = payload.fileName || null;
  } else if (type === "file-size-progress") {
    activeRuntimeStatus.lastFolderActivityAt = occurredAt;
    activeRuntimeStatus.activeReplay = true;
    activeRuntimeStatus.activeReplayBasename = payload.fileName || null;
    activeRuntimeStatus.activeReplaySizeBytes = payload.fileSizeBytes ?? null;
    activeRuntimeStatus.activeReplayLastChangedAt = payload.mtimeMs
      ? new Date(payload.mtimeMs).toISOString()
      : occurredAt;
  } else if (type === "upload-start") {
    activeUploadKeys.add(
      getUploadQueueKey(payload)
    );

    activeRuntimeStatus.uploadQueueLength =
      activeUploadKeys.size;

    activeRuntimeStatus.lastReplayUploadStatus =
      "uploading";
  } else if (type === "upload-success" || type === "upload-failure") {
    activeUploadKeys.delete(
      getUploadQueueKey(payload)
    );

    activeRuntimeStatus.uploadQueueLength =
      activeUploadKeys.size;

    activeRuntimeStatus.lastReplayUploadAt = occurredAt;
    activeRuntimeStatus.lastReplayUploadStatus = type === "upload-success" ? "succeeded" : "failed";
    activeRuntimeStatus.repeatedUploadErrors =
      type === "upload-success" ? 0 : activeRuntimeStatus.repeatedUploadErrors + 1;
  } else if (
    type === "final-settle-observation-complete" ||
    type === "monitor-stop"
  ) {
    activeRuntimeStatus.activeReplay = false;
  }

  try {
    activeEventHook({
      type,
      occurredAt,
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

function getWindowsDocumentRoots(home = os.homedir()) {
  return Array.from(
    new Set(
      [
        process.env.USERPROFILE && path.join(process.env.USERPROFILE, "Documents"),
        process.env.OneDrive && path.join(process.env.OneDrive, "Documents"),
        process.env.OneDriveCommercial && path.join(process.env.OneDriveCommercial, "Documents"),
        process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, "Documents"),
        path.join(home, "Documents"),
      ].filter(Boolean)
    )
  );
}

function includeMultiplayerReplayFolders(saveGameRoots) {
  return Array.from(
    new Set(
      saveGameRoots.flatMap((root) => [
        path.join(root, "multi"),
        root,
      ])
    )
  );
}

function getWindowsSteamRoots() {
  return Array.from(
    new Set(
      [
        process.env["ProgramFiles(x86)"] &&
          path.join(
            process.env["ProgramFiles(x86)"],
            "Steam"
          ),
        process.env.ProgramFiles &&
          path.join(
            process.env.ProgramFiles,
            "Steam"
          ),
        process.env.ProgramW6432 &&
          path.join(
            process.env.ProgramW6432,
            "Steam"
          ),
      ].filter(Boolean)
    )
  );
}

function getSteamLibraryRoots(steamRoots) {
  const libraryRoots =
    new Set(steamRoots);

  for (const steamRoot of steamRoots) {
    const libraryFile =
      path.join(
        steamRoot,
        "steamapps",
        "libraryfolders.vdf"
      );

    try {
      const raw =
        fs.readFileSync(
          libraryFile,
          "utf8"
        );

      for (
        const match of
          raw.matchAll(
            /"path"\s+"([^"]+)"/g
          )
      ) {
        const libraryRoot =
          match[1]
            .replace(/\\\\/g, "\\")
            .trim();

        if (libraryRoot) {
          libraryRoots.add(
            libraryRoot
          );
        }
      }
    } catch {
      // Steam may not be installed here, or this
      // installation may have no library manifest.
    }
  }

  return Array.from(
    libraryRoots
  );
}

function getWindowsSteamReplayFolders() {
  const steamRoots =
    getWindowsSteamRoots();

  const libraryRoots =
    getSteamLibraryRoots(
      steamRoots
    );

  return includeMultiplayerReplayFolders(
    libraryRoots.map(
      (libraryRoot) =>
        path.join(
          libraryRoot,
          "steamapps",
          "common",
          "Age2HD",
          "SaveGame"
        )
    )
  );
}

function replayFolderCandidates() {
  const home = os.homedir();
  const platform = os.platform();
  const hdSuffixes = [
    ["My Games", "Age of Empires 2 HD", "SaveGame"],
    ["My Games", "Age of Empires II HD", "SaveGame"],
  ];

  if (platform === "win32") {
    const documentSaveRoots =
      getWindowsDocumentRoots(home)
        .flatMap((root) =>
          hdSuffixes.map(
            (suffix) =>
              path.join(
                root,
                ...suffix
              )
          )
        );

    return Array.from(
      new Set([
        ...getWindowsSteamReplayFolders(),
        ...includeMultiplayerReplayFolders(
          documentSaveRoots
        ),
      ])
    );
  }

  if (platform === "darwin") {
    return includeMultiplayerReplayFolders([
      path.join(
        home,
        "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Age2HD/SaveGame"
      ),
      path.join(
        home,
        "Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/My Documents/My Games/Age of Empires 2 HD/SaveGame"
      ),
      ...hdSuffixes.map(
        (suffix) =>
          path.join(
            home,
            "Documents",
            ...suffix
          )
      ),
    ]);
  }

  return includeMultiplayerReplayFolders([
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
    ...hdSuffixes.map(
      (suffix) =>
        path.join(
          home,
          "Documents",
          ...suffix
        )
    ),
  ]);
}

function inspectReplayFolder(targetPath) {
  const normalizedPath = String(targetPath || "").trim();
  const label = normalizedPath ? path.basename(normalizedPath) : null;
  const normalizedLower = normalizedPath.toLowerCase();
  const appearsDe = /age of empires (ii|2) de/.test(normalizedLower);
  const appearsHd = /age of empires (ii|2) hd|age2hd/.test(normalizedLower);
  const result = {
    path: normalizedPath,
    exists: false,
    isDirectory: false,
    readable: false,
    valid: false,
    kind: appearsDe ? "de" : appearsHd ? "hd" : "manual",
    label,
    score: appearsHd ? 30 : appearsDe ? -100 : 0,
    supportedReplayCount: 0,
    latestReplayBasename: null,
    latestReplayModifiedAt: null,
    error: null,
  };

  if (!normalizedPath) return result;
  try {
    const stats = fs.statSync(normalizedPath);
    result.exists = stats.isDirectory();
    result.isDirectory = stats.isDirectory();
    if (!stats.isDirectory()) return result;
    fs.accessSync(normalizedPath, fs.constants.R_OK);
    result.readable = true;
    const entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !SUPPORTED_REPLAY_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      result.supportedReplayCount += 1;
      const fileStats = fs.statSync(path.join(normalizedPath, entry.name));
      if (!result.latestReplayModifiedAt || fileStats.mtimeMs > Date.parse(result.latestReplayModifiedAt)) {
        result.latestReplayBasename = entry.name;
        result.latestReplayModifiedAt = fileStats.mtime.toISOString();
      }
    }
    result.score += Math.min(40, result.supportedReplayCount * 4);
    if (result.latestReplayModifiedAt) {
      const ageMs = Date.now() - Date.parse(result.latestReplayModifiedAt);
      if (ageMs <= 24 * 60 * 60 * 1000) result.score += 20;
      else if (ageMs <= 30 * 24 * 60 * 60 * 1000) result.score += 10;
    }
    result.valid = result.readable && !appearsDe && (appearsHd || result.supportedReplayCount > 0);
    return result;
  } catch (error) {
    result.error = error.message || "Folder is inaccessible.";
    return result;
  }
}

function detectReplayFolder() {
  const inspected = replayFolderCandidates().map(inspectReplayFolder);
  return inspected
    .filter((candidate) => candidate.valid)
    .sort((left, right) => right.score - left.score)[0] || null;
}

function getDefaultReplayDir() {
  return detectReplayFolder()?.path || firstExistingPath(replayFolderCandidates());
}

function normalizeBaseUrl(value) {
  return (value || "").trim().replace(/\/$/, "");
}

function migrateLegacyBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  return LEGACY_DOMAIN_MIGRATIONS.reduce(
    (current, [from, to]) => current.replaceAll(from, to),
    normalized
  );
}

function buildRuntimeConfig(config = {}) {
  const defaultApiBaseUrl = "https://api-prodn.aoe2war.com";

  const apiBaseUrl = migrateLegacyBaseUrl(
    config.apiBaseUrl || process.env.AOE2_API_BASE_URL || defaultApiBaseUrl
  );

  const defaultFallbackApiBaseUrl =
    apiBaseUrl === defaultApiBaseUrl ? "https://aoe2war.com" : "";

  const apiFallbackBaseUrl = migrateLegacyBaseUrl(
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
    quietPeriodMs: Number(process.env.AOE2_UPLOAD_QUIET_PERIOD_MS || DEFAULT_FINAL_QUIET_PERIOD_MS),
    initialLiveDelayMs: Number(process.env.AOE2_INITIAL_LIVE_DELAY_MS || 3000),
    initialLiveRetryCooldownMs: Number(
      process.env.AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS || 10000
    ),
    liveUploadCooldownMs: Number(
      process.env.AOE2_LIVE_UPLOAD_COOLDOWN_MS || DEFAULT_LIVE_UPLOAD_COOLDOWN_MS
    ),
    finalCandidateMinAgeMs: Number(
      process.env.AOE2_FINAL_CANDIDATE_MIN_AGE_MS || DEFAULT_FINAL_CANDIDATE_MIN_AGE_MS
    ),
    finalCandidateCooldownMs: Number(
      process.env.AOE2_FINAL_CANDIDATE_COOLDOWN_MS || DEFAULT_FINAL_CANDIDATE_COOLDOWN_MS
    ),
    finalCandidateStableSamples: Number(process.env.AOE2_FINAL_CANDIDATE_STABLE_SAMPLES || 2),
    finalSettleWindowMs: Number(
      process.env.AOE2_FINAL_SETTLE_WINDOW_MS || DEFAULT_FINAL_SETTLE_WINDOW_MS
    ),
    firstBytesTimeoutMs: Number(process.env.AOE2_FIRST_BYTES_TIMEOUT_MS || 15 * 60 * 1000),
    firstBytesPollMs: Number(process.env.AOE2_FIRST_BYTES_POLL_MS || 1000),
    replayProgressLogIntervalMs: Number(
      process.env.AOE2_REPLAY_PROGRESS_LOG_INTERVAL_MS || 180000
    ),
    recoveryScanIntervalMs: Math.max(
      2000,
      Number(
        process.env.AOE2_RECOVERY_SCAN_INTERVAL_MS ||
          DEFAULT_RECOVERY_SCAN_INTERVAL_MS
      )
    ),
    minReplayBytes: Number(process.env.AOE2_MIN_REPLAY_BYTES || 131072),
    watcherUid:
      process.env.WATCHER_USER_UID ||
      `watcher-${crypto
        .createHash("sha1")
        .update(os.hostname())
        .digest("hex")
        .slice(0, 12)}`,
    watcherId: config.watcherId || process.env.AOE2_WATCHER_ID || null,
    appSessionId: config.appSessionId || process.env.AOE2_WATCHER_SESSION_ID || null,
    settlementStatePath:
      config.settlementStatePath ||
      process.env.AOE2_SETTLEMENT_STATE_PATH ||
      null,
  };
}

function getRuntimeValidationError(runtimeConfig) {
  const folder = inspectReplayFolder(runtimeConfig.watchDir);
  if (!folder.exists || !folder.isDirectory) {
    return `Replay directory does not exist: ${runtimeConfig.watchDir || "(empty)"}`;
  }

  if (!folder.readable) {
    return `Replay directory is not readable: ${path.basename(runtimeConfig.watchDir)}`;
  }

  if (!folder.valid) {
    return folder.kind === "de"
      ? "This is an AoE2 DE folder. Choose the AoE2 HD SaveGame folder."
      : "Folder does not look like an AoE2 HD SaveGame folder yet.";
  }

  if (!runtimeConfig.uploadApiKey) {
    return "Profile is not paired. Click Pair Profile before starting.";
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

const MAX_SERVER_RETRY_AFTER_MS =
  5 * 60 * 1000;
const MAX_UPLOAD_RETRY_JITTER_MS =
  2000;

function parseRetryAfterMs(
  value,
  now = Date.now()
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const text =
    String(value).trim();

  if (!text) {
    return 0;
  }

  const seconds =
    Number(text);

  if (
    Number.isFinite(seconds) &&
    seconds >= 0
  ) {
    return Math.min(
      MAX_SERVER_RETRY_AFTER_MS,
      Math.ceil(
        seconds * 1000
      )
    );
  }

  const retryAt =
    Date.parse(text);

  if (!Number.isFinite(retryAt)) {
    return 0;
  }

  return Math.min(
    MAX_SERVER_RETRY_AFTER_MS,
    Math.max(
      0,
      retryAt - now
    )
  );
}

function readRetryAfterHeader(error) {
  const headers =
    error?.response?.headers;

  if (!headers) {
    return null;
  }

  if (
    typeof headers.get ===
    "function"
  ) {
    return headers.get(
      "retry-after"
    );
  }

  return (
    headers["retry-after"] ??
    headers["Retry-After"] ??
    null
  );
}

function getRetryDelayMsFactory(
  runtimeConfig,
  attempt,
  {
    retryAfterMs = 0,
    random = Math.random,
  } = {}
) {
  const exponentialDelay =
    Math.min(
      runtimeConfig.retryBaseDelayMs *
        Math.max(
          1,
          2 **
            Math.max(
              0,
              attempt - 1
            )
        ),
      30000
    );

  const serverFloor =
    Number.isFinite(retryAfterMs)
      ? Math.max(
          0,
          Math.min(
            MAX_SERVER_RETRY_AFTER_MS,
            retryAfterMs
          )
        )
      : 0;

  const floor =
    Math.max(
      exponentialDelay,
      serverFloor
    );

  const jitterWindow =
    Math.min(
      MAX_UPLOAD_RETRY_JITTER_MS,
      Math.max(
        250,
        Math.floor(
          floor * 0.2
        )
      )
    );

  const randomValue =
    Math.max(
      0,
      Math.min(
        1,
        Number(random()) || 0
      )
    );

  return (
    floor +
    Math.floor(
      jitterWindow *
        randomValue
    )
  );
}

async function getFileFingerprint(filePath) {
  const stats = await fs.promises.stat(filePath);
  return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
}

async function createReplayUploadSnapshot(filePath) {
  const sourceStats =
    await fs.promises.stat(filePath);

  const replayBuffer =
    await fs.promises.readFile(filePath);

  const fileSizeBytes =
    replayBuffer.length;

  const mtimeMs =
    Math.floor(sourceStats.mtimeMs);

  const fingerprint =
    `${fileSizeBytes}:${mtimeMs}`;

  const sha256 = crypto
    .createHash("sha256")
    .update(replayBuffer)
    .digest("hex");

  return {
    replayBuffer,
    fileSizeBytes,
    mtimeMs,
    fingerprint,
    sha256,
  };
}

function signWatcherProvenance({
  apiKey,
  provenance,
  watcherUid,
  watcherId,
  watcherSessionId,
  replayFingerprint,
  replaySha256,
  parseIteration,
  isFinal,
}) {
  if (!apiKey) return null;
  const canonical = [
    "aoe2war-watcher-provenance/v1",
    provenance,
    watcherUid,
    watcherId,
    watcherSessionId,
    replayFingerprint,
    replaySha256,
    String(parseIteration),
    isFinal ? "true" : "false",
  ].join("\n");
  return crypto
    .createHmac("sha256", String(apiKey))
    .update(canonical)
    .digest("hex");
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

function createStateEntry(patch = {}) {
  return {
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
    lastFinalCandidateAt: 0,
    lastFinalCandidateFingerprint: null,
    lastFinalDeferralReason: null,
    lastFinalDeferralNoticeAt: 0,
    lastReplayGrowthNoticeAt: 0,
    monitorStartedAt: 0,
    finalAccepted: false,
    finalStored: false,
    liveIteration: 0,
    ...patch,
  };
}

function getStateEntry(filePath) {
  let entry = activeUploadState.get(filePath);

  if (!entry) {
    entry = createStateEntry();

    activeUploadState.set(
      filePath,
      entry
    );
  }

  return entry;
}

function shouldPersistSettlementEntry(
  entry
) {
  return Boolean(
    entry &&
      (entry.finalAccepted ||
        entry.finalStored) &&
      (entry.lastFinalUploadedFingerprint ||
        entry.lastFinalReplayHash) &&
      Number(entry.lastFinalUploadAt || 0) >
        0
  );
}

function buildPersistedSettlementState(
  stateMap = activeUploadState,
  now = Date.now()
) {
  const entries = [];

  for (
    const [filePath, entry] of stateMap
  ) {
    if (
      !shouldPersistSettlementEntry(
        entry
      )
    ) {
      continue;
    }

    if (
      now -
        Number(
          entry.lastFinalUploadAt || 0
        ) >
      SETTLEMENT_STATE_MAX_AGE_MS
    ) {
      continue;
    }

    entries.push({
      filePath,
      lastObservedFingerprint:
        entry.lastObservedFingerprint ||
        null,
      lastChangeAt:
        Number(entry.lastChangeAt || 0),
      lastFinalUploadedFingerprint:
        entry.lastFinalUploadedFingerprint ||
        null,
      lastFinalReplayHash:
        entry.lastFinalReplayHash ||
        null,
      lastFinalUploadAt:
        Number(
          entry.lastFinalUploadAt || 0
        ),
      finalAccepted:
        Boolean(entry.finalAccepted),
      finalStored:
        Boolean(entry.finalStored),
    });
  }

  entries.sort(
    (left, right) =>
      right.lastFinalUploadAt -
      left.lastFinalUploadAt
  );

  return {
    version:
      SETTLEMENT_STATE_VERSION,
    updatedAt:
      new Date(now).toISOString(),
    entries:
      entries.slice(
        0,
        SETTLEMENT_STATE_MAX_ENTRIES
      ),
  };
}

function restorePersistedSettlementState(
  snapshot,
  {
    watchDir = null,
    now = Date.now(),
  } = {}
) {
  let parsed = snapshot;

  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed);
  }

  const restored = new Map();

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.entries)
  ) {
    return restored;
  }

  const root = watchDir
    ? path.resolve(watchDir)
    : null;

  for (const saved of parsed.entries) {
    const filePath =
      typeof saved?.filePath ===
      "string"
        ? saved.filePath
        : null;

    if (!filePath) {
      continue;
    }

    if (root) {
      const relative =
        path.relative(
          root,
          path.resolve(filePath)
        );

      if (
        relative.startsWith("..") ||
        path.isAbsolute(relative)
      ) {
        continue;
      }
    }

    const lastFinalUploadAt =
      Number(
        saved.lastFinalUploadAt || 0
      );

    if (
      lastFinalUploadAt <= 0 ||
      now - lastFinalUploadAt >
        SETTLEMENT_STATE_MAX_AGE_MS
    ) {
      continue;
    }

    const entry =
      createStateEntry({
        lastObservedFingerprint:
          saved.lastObservedFingerprint ||
          null,
        lastChangeAt:
          Number(
            saved.lastChangeAt || 0
          ),
        lastFinalUploadedFingerprint:
          saved.lastFinalUploadedFingerprint ||
          null,
        lastFinalReplayHash:
          saved.lastFinalReplayHash ||
          null,
        lastFinalUploadAt,
        finalAccepted:
          Boolean(
            saved.finalAccepted
          ),
        finalStored:
          Boolean(saved.finalStored),
      });

    if (
      shouldPersistSettlementEntry(
        entry
      )
    ) {
      restored.set(
        filePath,
        entry
      );
    }
  }

  return restored;
}

function persistSettlementState() {
  if (!activeSettlementStatePath) {
    return;
  }

  try {
    const snapshot =
      buildPersistedSettlementState();

    fs.mkdirSync(
      path.dirname(
        activeSettlementStatePath
      ),
      {
        recursive: true,
      }
    );

    const tempPath =
      `${activeSettlementStatePath}.tmp-${process.pid}`;

    fs.writeFileSync(
      tempPath,
      `${JSON.stringify(
        snapshot,
        null,
        2
      )}\n`,
      "utf8"
    );

    fs.renameSync(
      tempPath,
      activeSettlementStatePath
    );
  } catch (error) {
    log(
      `Unable to persist replay settlement state: ${
        error.message || error
      }`,
      "warn"
    );
  }
}

function loadSettlementState(
  statePath,
  watchDir
) {
  if (
    !statePath ||
    !fs.existsSync(statePath)
  ) {
    return 0;
  }

  try {
    const raw =
      fs.readFileSync(
        statePath,
        "utf8"
      );

    const restored =
      restorePersistedSettlementState(
        raw,
        {
          watchDir,
        }
      );

    for (
      const [filePath, entry] of
      restored
    ) {
      activeUploadState.set(
        filePath,
        entry
      );
    }

    return restored.size;
  } catch (error) {
    log(
      `Unable to restore replay settlement state: ${
        error.message || error
      }`,
      "warn"
    );

    return 0;
  }
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

function getParseSource(isFinal) {
  return isFinal ? "watcher_final" : "watcher_live";
}

function getParseReason(isFinal) {
  return isFinal ? "watcher_final_submission" : "watcher_live_iteration";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFingerprintParts(fingerprint = "") {
  const [sizeRaw, mtimeRaw] = String(fingerprint || "").split(":");
  const fileSizeBytes = Number(sizeRaw);
  const mtimeMs = Number(mtimeRaw);

  return {
    fileSizeBytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null,
  };
}

function isTruthyResponseFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function safeShortText(value, maxLength = 600) {
  let text;

  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function summarizeUploadResponse(data = {}) {
  const finalityStatus = data?.finality_status || data?.finalityStatus || null;
  const pendingParse = isTruthyResponseFlag(data?.pending_parse ?? data?.pendingParse);
  const unparsedFinal = isTruthyResponseFlag(data?.unparsed_final ?? data?.unparsedFinal);
  const explicitParseCompleted = data?.parse_completed ?? data?.parseCompleted;
  const parseCompleted =
    explicitParseCompleted === undefined || explicitParseCompleted === null
      ? !pendingParse &&
        !unparsedFinal &&
        Boolean(finalityStatus) &&
        !["live_pending_parse", "final_unparsed_proof"].includes(String(finalityStatus || ""))
      : isTruthyResponseFlag(explicitParseCompleted);

  const summary = {
    resultType: classifyUploadResult(formatResponseBody(data)),
    replayHash: data?.replay_hash || data?.replayHash || data?.hash || null,
    gameId: data?.game_id || data?.gameId || data?.id || null,
    finalityStatus,
    shouldSettle: isTruthyResponseFlag(data?.should_settle ?? data?.shouldSettle),
    finalAccepted: isTruthyResponseFlag(data?.final_accepted ?? data?.finalAccepted),
    pendingParse,
    unparsedFinal,
    archived: isTruthyResponseFlag(data?.raw_replay_archived ?? data?.rawReplayArchived),
    parseCompleted,
    summary: safeShortText(data, 800),
  };

  summary.resultReady = summary.finalAccepted || isTrustedFinalResponse(summary);
  return summary;
}

function isTrustedFinalResponse(responseSummary = {}) {
  if (responseSummary.shouldSettle) {
    return true;
  }

  return [
    "trusted_final",
    "trusted_final_duplicate",
    "trusted_final_refreshed",
    "reviewed_match_duplicate",
    "reviewed_match_refreshed",
  ].includes(String(responseSummary.finalityStatus || ""));
}

function classifyReplayAcceptance(responseSummary = {}, { isFinal = true } = {}) {
  const resultReady = Boolean(isFinal && responseSummary.resultReady);

  return {
    archived: Boolean(responseSummary.archived),
    parsed: Boolean(responseSummary.parseCompleted),
    resultReady,
    reviewRouted: Boolean(isFinal && !resultReady),
  };
}

function buildReplayReceiptDetail(fileName, acceptance = {}, { isFinal = true } = {}) {
  const replayName = path.basename(String(fileName || "Replay"));

  if (!isFinal) {
    return `${replayName} live replay stream received.`;
  }

  if (acceptance.resultReady) {
    return `${replayName} result ready and filed.`;
  }

  if (acceptance.parsed) {
    return `${replayName} parsed and routed through result review.`;
  }

  if (acceptance.archived) {
    return `${replayName} secured and routed through result review.`;
  }

  return `${replayName} received and routed through result review.`;
}

function isUnknownishValue(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "unknown" ||
    normalized === "unknown map" ||
    normalized === "unknown player" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "null" ||
    normalized === "undefined"
  );
}

function isImportantParseField(key = "") {
  const normalized = String(key || "").toLowerCase();
  return (
    normalized === "map" ||
    normalized === "map_name" ||
    normalized === "mapname" ||
    normalized === "winner" ||
    normalized === "duration" ||
    normalized === "game_duration" ||
    normalized === "players" ||
    normalized === "player" ||
    normalized === "name" ||
    normalized.includes("map") ||
    normalized.includes("winner") ||
    normalized.includes("duration")
  );
}

function detectUnknownParseFields(payload) {
  const found = new Set();

  function visit(value, pathParts = []) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathParts, key];
      const childPathText = childPath.join(".");
      const important = isImportantParseField(key);

      if (important && isUnknownishValue(child)) {
        found.add(childPathText);
        continue;
      }

      if (important && Array.isArray(child) && child.length === 0) {
        found.add(childPathText);
        continue;
      }

      if (important && child && typeof child === "object") {
        const objectName = child.name || child.label || child.value;
        if (isUnknownishValue(objectName)) {
          found.add(`${childPathText}.name`);
        }
      }

      visit(child, childPath);
    }
  }

  visit(payload);
  return Array.from(found).slice(0, 30);
}

async function waitForFirstBytes(filePath, runtimeConfig) {
  const startedAt = Date.now();
  let lastSize = null;
  let lastProgressEventAt = 0;
  let lastWaitingEventAt = 0;

  while (Date.now() - startedAt <= runtimeConfig.firstBytesTimeoutMs) {
    if (!fs.existsSync(filePath)) {
      log(`Replay disappeared before first parse: ${path.basename(filePath)}`, "warn");
      emitRuntimeEvent("skip-file-missing", {
        filePath,
        fileName: path.basename(filePath),
        reason: "missing_before_byte_floor",
        minReplayBytes: runtimeConfig.minReplayBytes,
        waitedMs: Date.now() - startedAt,
      });
      return false;
    }

    try {
      const stats = await fs.promises.stat(filePath);
      const now = Date.now();
      const payload = {
        filePath,
        fileName: path.basename(filePath),
        fileSizeBytes: stats.size,
        previousFileSizeBytes: lastSize,
        minReplayBytes: runtimeConfig.minReplayBytes,
        mtimeMs: Math.floor(stats.mtimeMs),
        waitedMs: now - startedAt,
        remainingTimeoutMs: Math.max(0, runtimeConfig.firstBytesTimeoutMs - (now - startedAt)),
      };

      if (stats.size !== lastSize || now - lastProgressEventAt >= 30000) {
        emitRuntimeEvent("file-size-progress", {
          ...payload,
          reachedMinimum: stats.size >= runtimeConfig.minReplayBytes,
        });
        lastProgressEventAt = now;
      }

      if (stats.size >= runtimeConfig.minReplayBytes) {
        return true;
      }

      if (now - lastWaitingEventAt >= 15000) {
        emitRuntimeEvent("waiting-for-minimum-size", payload);
        lastWaitingEventAt = now;
      }

      lastSize = stats.size;
    } catch (err) {
      log(
        `Unable to inspect ${path.basename(filePath)} before live parse: ${err.message}`,
        "warn"
      );
      emitRuntimeEvent("watcher-error", {
        filePath,
        fileName: path.basename(filePath),
        detail: err.message,
        reason: "stat_failed_before_byte_floor",
      });
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

  emitRuntimeEvent("skip-file-too-small", {
    filePath,
    fileName: path.basename(filePath),
    reason: "byte_floor_timeout",
    fileSizeBytes: lastSize,
    minReplayBytes: runtimeConfig.minReplayBytes,
    waitedMs: Date.now() - startedAt,
  });

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
    (entry.finalAccepted || entry.finalStored) &&
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
  if (
    (!entry.finalAccepted && !entry.finalStored) ||
    (!entry.lastFinalUploadedFingerprint && !entry.lastFinalReplayHash)
  ) {
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

  persistSettlementState();

  return {
    reason: "settled_replay_hash",
    fingerprint: nextFingerprint,
    replayHash: contentHash,
  };
}

async function uploadReplay(
  filePath,
  runtimeConfig,
  {
    parseIteration = 1,
    isFinal = true,
    provenance = WATCHER_PROVENANCE_LIVE_MONITOR,
    uploadUrl,
    snapshot: providedSnapshot = null,
  } = {}
) {
  const snapshot =
    providedSnapshot ||
    await createReplayUploadSnapshot(
      filePath
    );

  const form = new FormData();

  form.append(
    "file",
    snapshot.replayBuffer,
    {
      filename:
        path.basename(filePath),

      contentType:
        "application/octet-stream",

      knownLength:
        snapshot.fileSizeBytes,
    }
  );

  const parseSource =
    getParseSource(isFinal);

  const parseReason =
    getParseReason(isFinal);

  const headers = {
    ...form.getHeaders(),

    "x-user-uid":
      runtimeConfig.watcherUid,

    "x-parse-iteration":
      String(parseIteration),

    "x-is-final":
      isFinal ? "true" : "false",

    "x-parse-source":
      parseSource,

    "x-parse-reason":
      parseReason,

    "x-watcher-provenance":
      provenance,
  };

  const metadataHeaders = {
    "x-watcher-id":
      runtimeConfig.watcherId,

    "x-watcher-session-id":
      runtimeConfig.appSessionId,

    "x-replay-fingerprint":
      snapshot.fingerprint,

    "x-client-sha256":
      snapshot.sha256,

    "x-file-size-bytes":
      snapshot.fileSizeBytes,

    "x-file-mtime-ms":
      snapshot.mtimeMs,

    "x-final-candidate":
      isFinal ? "true" : "false",

    "x-watcher-provenance-signature":
      signWatcherProvenance({
        apiKey: runtimeConfig.uploadApiKey,
        provenance,
        watcherUid: runtimeConfig.watcherUid,
        watcherId: runtimeConfig.watcherId,
        watcherSessionId: runtimeConfig.appSessionId,
        replayFingerprint: snapshot.fingerprint,
        replaySha256: snapshot.sha256,
        parseIteration,
        isFinal,
      }),
  };

  for (
    const [name, value]
    of Object.entries(
      metadataHeaders
    )
  ) {
    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      headers[name] =
        String(value);
    }
  }

  if (
    runtimeConfig.uploadApiKey
  ) {
    headers["x-api-key"] =
      runtimeConfig.uploadApiKey;
  }

  try {
    headers["Content-Length"] =
      await getFormLength(form);
  } catch (error) {
    log(
      `Unable to precompute upload size for ${
        path.basename(filePath)
      }: ${error.message}`,
      "warn"
    );
  }

  try {
    const response =
      await axios.post(
        uploadUrl,
        form,
        {
          timeout: 60000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers,
        }
      );

    return {
      response,
      snapshot,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object"
    ) {
      error.replayUploadSnapshot =
        snapshot;
    }

    throw error;
  }
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
  {
    fingerprint,
    parseIteration,
    isFinal,
    provenance = WATCHER_PROVENANCE_LIVE_MONITOR,
  }
) {
  const maxAttempts = runtimeConfig.maxUploadRetries + 1;
  let attemptFingerprint = fingerprint;
  let retrySnapshot = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!retrySnapshot) {
      retrySnapshot =
        await createReplayUploadSnapshot(
          filePath
        );

      attemptFingerprint =
        retrySnapshot.fingerprint;
    }

    const retryLabel =
      attempt > 0 ? ` (retry ${attempt}/${runtimeConfig.maxUploadRetries})` : "";
    const targetSequence = getUploadTargetsForAttempt(runtimeConfig);

    for (let targetIndex = 0; targetIndex < targetSequence.length; targetIndex += 1) {
      const target = targetSequence[targetIndex];
      const targetHost = new URL(target.uploadUrl).host;
      const parseSource = getParseSource(isFinal);
      const parseReason = getParseReason(isFinal);

      emitRuntimeEvent("upload-start", {
        filePath,
        fileName: path.basename(filePath),
        isFinal,
        parseIteration,
        parseSource,
        parseReason,
        provenance,
        attempt,
        maxRetryCount: runtimeConfig.maxUploadRetries,
        uploadHost: targetHost,
        fingerprint: attemptFingerprint,
        ...parseFingerprintParts(attemptFingerprint),
      });

      log(
        `${isFinal ? "Uploading final replay" : "Uploading live replay"}: ${filePath} ` +
          `[iteration ${parseIteration}]${retryLabel}${
            runtimeConfig.uploadTargets.length > 1 ? ` via ${targetHost}` : ""
          }`
      );

      try {
        const uploadResult =
          await uploadReplay(
            filePath,
            runtimeConfig,
            {
              parseIteration,
              isFinal,
              provenance,
              uploadUrl:
                target.uploadUrl,
              snapshot:
                retrySnapshot,
            }
          );

        const res =
          uploadResult.response;

        attemptFingerprint =
          uploadResult
            .snapshot
            .fingerprint;

        const fingerprintParts = {
          fileSizeBytes:
            uploadResult
              .snapshot
              .fileSizeBytes,

          mtimeMs:
            uploadResult
              .snapshot
              .mtimeMs,
        };

        const detail =
          formatResponseBody(
            res.data
          );
        const resultType = classifyUploadResult(detail);
        const responseSummary = summarizeUploadResponse(res.data);
        const acceptance = classifyReplayAcceptance(responseSummary, { isFinal });
        const unknownParseFields = detectUnknownParseFields(res.data);
        const finalAccepted = acceptance.resultReady;
        const finalStored = Boolean(isFinal && (acceptance.archived || finalAccepted));

        if (unknownParseFields.length > 0) {
          emitRuntimeEvent("parse-result-unknown-fields", {
            filePath,
            fileName: path.basename(filePath),
            isFinal,
            parseIteration,
            parseSource,
            parseReason,
            provenance,
            uploadHost: targetHost,
            attempt,
            responseStatus: res.status,
            resultType,
            replayHash: responseSummary.replayHash,
            unknownFields: unknownParseFields,
            responseSummary: responseSummary.summary,
            ...parseFingerprintParts(attemptFingerprint),
          });
        }

        const replayHash =
          typeof res?.data?.replay_hash === "string" && res.data.replay_hash.trim()
            ? res.data.replay_hash.trim()
            : null;

        rememberWorkingUploadTarget(target);

        if (finalStored) {
          entry.lastFinalUploadedFingerprint = attemptFingerprint;
          entry.lastFinalUploadAt = Date.now();
          entry.finalStored = true;
          entry.finalAccepted = finalAccepted;
          if (replayHash) {
            entry.lastFinalReplayHash = replayHash;
          }
        } else if (isFinal) {
          entry.lastFinalCandidateFingerprint = attemptFingerprint;
          entry.lastFinalCandidateAt = Date.now();
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

        if (finalStored) {
          persistSettlementState();
        }

        log(`Uploaded (${res.status}): ${path.basename(filePath)}${detail ? ` - ${detail}` : ""}`);

        emitRuntimeEvent("upload-success", {
          filePath,
          fileName: path.basename(filePath),
          isFinal,
          parseIteration,
          parseSource,
          parseReason,
          replayHash,
          resultType,
          finalityStatus: responseSummary.finalityStatus,
          shouldSettle: responseSummary.shouldSettle,
          pendingParse: responseSummary.pendingParse,
          unparsedFinal: responseSummary.unparsedFinal,
          archived: acceptance.archived,
          parseCompleted: acceptance.parsed,
          resultReady: acceptance.resultReady,
          reviewRouted: acceptance.reviewRouted,
          finalAccepted,
          finalStored,
          responseStatus: res.status,
          detail,
          ...fingerprintParts,
        });

        if (isFinal) {
          emitRuntimeEvent(finalAccepted ? "final-candidate-accepted" : "final-candidate-deferred", {
            filePath,
            fileName: path.basename(filePath),
            isFinal,
            parseIteration,
            parseSource,
            parseReason,
            replayHash,
            resultType,
            finalityStatus: responseSummary.finalityStatus,
            shouldSettle: responseSummary.shouldSettle,
            pendingParse: responseSummary.pendingParse,
            unparsedFinal: responseSummary.unparsedFinal,
            archived: acceptance.archived,
            parseCompleted: acceptance.parsed,
            resultReady: acceptance.resultReady,
            reviewRouted: acceptance.reviewRouted,
            detail,
            ...fingerprintParts,
          });
        }

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
          finalAccepted,
          finalStored,
          finalityStatus: responseSummary.finalityStatus,
          shouldSettle: responseSummary.shouldSettle,
          archived: acceptance.archived,
          parsed: acceptance.parsed,
          resultReady: acceptance.resultReady,
          reviewRouted: acceptance.reviewRouted,
          replayHash,
        };
      } catch (err) {
        if (
          err
            ?.replayUploadSnapshot
            ?.fingerprint
        ) {
          attemptFingerprint =
            err
              .replayUploadSnapshot
              .fingerprint;
        }

        const responseDetail =
          formatResponseBody(
            err?.response?.data
          );
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
            parseSource,
            parseReason,
            errorMessage,
            responseStatus: err?.response?.status || null,
            fingerprint: attemptFingerprint,
            ...parseFingerprintParts(attemptFingerprint),
          });
          return {
            ok: false,
            errorMessage,
            responseStatus: err?.response?.status || null,
          };
        }

        const retryAfterMs =
          parseRetryAfterMs(
            readRetryAfterHeader(
              err
            )
          );

        const delayMs =
          getRetryDelayMsFactory(
            runtimeConfig,
            attempt + 1,
            {
              retryAfterMs,
            }
          );

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
          parseSource,
          parseReason,
          errorMessage,
          retryInMs: delayMs,
          nextRetryAttempt: attempt + 1,
          maxRetryCount: runtimeConfig.maxUploadRetries,
          responseStatus: err?.response?.status || null,
          fingerprint: attemptFingerprint,
          ...parseFingerprintParts(attemptFingerprint),
        });

        if (isReplayFinalizingError(err)) {
          await waitForReplayProgress(
            filePath,
            attemptFingerprint,
            delayMs
          );

          retrySnapshot = null;
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

function shouldEmitFinalDeferral(entry, reason, now = Date.now()) {
  if (
    entry.lastFinalDeferralReason !== reason ||
    entry.lastFinalDeferralNoticeAt === 0 ||
    now - entry.lastFinalDeferralNoticeAt >= 60000
  ) {
    entry.lastFinalDeferralReason = reason;
    entry.lastFinalDeferralNoticeAt = now;
    return true;
  }

  return false;
}

async function getFinalCandidateReadiness(filePath, entry, runtimeConfig, fingerprint, now) {
  const observedForMs = entry.monitorStartedAt > 0 ? now - entry.monitorStartedAt : 0;
  if (observedForMs < runtimeConfig.finalCandidateMinAgeMs) {
    return {
      ready: false,
      reason: "minimum_observation_window",
      observedForMs,
      requiredMs: runtimeConfig.finalCandidateMinAgeMs,
      waitMs: runtimeConfig.finalCandidateMinAgeMs - observedForMs,
    };
  }

  if (
    entry.lastFinalCandidateAt > 0 &&
    entry.lastFinalCandidateFingerprint === fingerprint &&
    now - entry.lastFinalCandidateAt < runtimeConfig.finalCandidateCooldownMs
  ) {
    return {
      ready: false,
      reason: "final_candidate_cooldown",
      waitMs: runtimeConfig.finalCandidateCooldownMs - (now - entry.lastFinalCandidateAt),
    };
  }

  let stableFingerprint = fingerprint;
  const sampleCount = Math.max(1, runtimeConfig.finalCandidateStableSamples || 1);

  for (let sample = 1; sample < sampleCount; sample += 1) {
    await sleep(runtimeConfig.stableCheckIntervalMs);
    if (!fs.existsSync(filePath)) {
      return {
        ready: false,
        reason: "missing_during_final_stability",
      };
    }

    const nextFingerprint = await getFileFingerprint(filePath);
    if (nextFingerprint !== stableFingerprint) {
      const changedAt = Date.now();
      entry.lastObservedFingerprint = nextFingerprint;
      entry.lastChangeAt = changedAt;
      return {
        ready: false,
        reason: "changed_during_final_stability",
        fingerprint: nextFingerprint,
        changedAt,
      };
    }

    stableFingerprint = nextFingerprint;
  }

  return {
    ready: true,
    reason: "quiet_and_stable",
    fingerprint: stableFingerprint,
    observedForMs,
    sampleCount,
  };
}

async function reopenFinalIfReplayGrew(filePath, entry, fingerprint) {
  if (
    (!entry.finalAccepted && !entry.finalStored) ||
    fingerprint === entry.lastFinalUploadedFingerprint
  ) {
    return false;
  }

  if (entry.lastFinalReplayHash) {
    try {
      const contentHash = await getReplayContentHash(filePath);
      if (contentHash === entry.lastFinalReplayHash) {
        entry.lastObservedFingerprint = fingerprint;
        entry.lastFinalUploadedFingerprint = fingerprint;

        persistSettlementState();

        return false;
      }
    } catch (error) {
      log(`Unable to verify changed final replay hash for ${path.basename(filePath)}: ${error.message}`, "warn");
    }
  }

  emitRuntimeEvent("final-candidate-reopened", {
    filePath,
    fileName: path.basename(filePath),
    reason: "replay_changed_after_final_acceptance",
    previousReplayHash: entry.lastFinalReplayHash,
    previousFinalFingerprint: entry.lastFinalUploadedFingerprint,
    fingerprint,
    ...parseFingerprintParts(fingerprint),
  });

  entry.finalAccepted = false;
  entry.finalStored = false;
  entry.lastFinalUploadedFingerprint = null;
  entry.lastFinalReplayHash = null;
  entry.lastFinalUploadAt = 0;
  entry.lastFinalCandidateFingerprint = null;

  persistSettlementState();

  return true;
}

async function monitorReplayFile(filePath, runtimeConfig) {
  if (!shouldHandle(filePath, runtimeConfig)) {
    log(`Ignoring non-replay file: ${path.basename(filePath)}`, "warn");
    emitRuntimeEvent("skip-unknown", {
      filePath,
      fileName: path.basename(filePath),
      reason: "unsupported_extension",
    });
    return;
  }

  const entry = getStateEntry(filePath);
  if (entry.monitoring) {
    log(`Skipping duplicate monitor for ${path.basename(filePath)} because it is already active.`);
    emitRuntimeEvent("skip-upload-in-progress", {
      filePath,
      fileName: path.basename(filePath),
      reason: "monitor_already_active",
    });
    return;
  }

  if (entry.importing) {
    log(`Skipping live monitor for ${path.basename(filePath)} because it is importing already.`, "warn");
    emitRuntimeEvent("skip-upload-in-progress", {
      filePath,
      fileName: path.basename(filePath),
      reason: "batch_upload_active",
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
      `Skipping monitor for ${path.basename(filePath)} because replay already matches final upload state (${finalReplayShortCircuit.reason}).`
    );
    emitRuntimeEvent("monitor-skip-final", {
      filePath,
      fileName: path.basename(filePath),
      reason: finalReplayShortCircuit.reason,
      replayHash: finalReplayShortCircuit.replayHash || entry.lastFinalReplayHash || null,
    });
    emitRuntimeEvent("skip-already-finalized", {
      filePath,
      fileName: path.basename(filePath),
      reason: finalReplayShortCircuit.reason,
      replayHash: finalReplayShortCircuit.replayHash || entry.lastFinalReplayHash || null,
    });
    return;
  }

  entry.monitoring = true;
  entry.monitorStartedAt = Date.now();
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

        emitRuntimeEvent("final-settle-observation-complete", {
          filePath,
          fileName: path.basename(filePath),
          replayHash: entry.lastFinalReplayHash || null,
          finalAccepted: entry.finalAccepted,
          finalStored: entry.finalStored,
          settleWindowMs: runtimeConfig.finalSettleWindowMs,
          fingerprint,
          ...parseFingerprintParts(fingerprint),
        });

        return;
      }

      const changed = fingerprint !== entry.lastObservedFingerprint;

      if (changed) {
        await reopenFinalIfReplayGrew(filePath, entry, fingerprint);
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
        const readiness = await getFinalCandidateReadiness(
          filePath,
          entry,
          runtimeConfig,
          fingerprint,
          now
        );

        if (!readiness.ready) {
          if (shouldEmitFinalDeferral(entry, readiness.reason)) {
            log(
              `Final upload deferred for ${path.basename(filePath)}: ${readiness.reason}${
                readiness.waitMs ? ` (${Math.round(readiness.waitMs / 1000)}s remaining)` : ""
              }.`
            );
            emitRuntimeEvent("final-candidate-deferred", {
              filePath,
              fileName: path.basename(filePath),
              reason: readiness.reason,
              waitMs: readiness.waitMs || null,
              observedForMs: readiness.observedForMs || null,
              requiredMs: readiness.requiredMs || null,
              fingerprint: readiness.fingerprint || fingerprint,
              ...parseFingerprintParts(readiness.fingerprint || fingerprint),
            });
          }
          await sleep(runtimeConfig.stableCheckIntervalMs);
          continue;
        }

        log(
          `Final candidate ready for ${path.basename(filePath)} after ${Math.round(
            runtimeConfig.quietPeriodMs / 1000
          )}s quiet and ${Math.round((readiness.observedForMs || 0) / 1000)}s observed.`
        );

        emitRuntimeEvent("final-candidate-ready", {
          filePath,
          fileName: path.basename(filePath),
          reason: readiness.reason,
          observedForMs: readiness.observedForMs,
          sampleCount: readiness.sampleCount,
          fingerprint: readiness.fingerprint || fingerprint,
          ...parseFingerprintParts(readiness.fingerprint || fingerprint),
        });

        const nextIteration = Math.max(1, entry.liveIteration + 1);
        entry.lastFinalCandidateAt = Date.now();
        entry.lastFinalCandidateFingerprint = readiness.fingerprint || fingerprint;
        const stored = await uploadReplayWithRetry(filePath, runtimeConfig, entry, {
          fingerprint: readiness.fingerprint || fingerprint,
          parseIteration: nextIteration,
          isFinal: true,
        });

        if (stored.ok && stored.finalStored && !stored.changedDuringUpload) {
          log(
            `Final replay stored for ${path.basename(
              filePath
            )}. Continuing byte observation for up to ${Math.round(
              runtimeConfig.finalSettleWindowMs / 1000
            )}s before declaring the replay fully settled.`
          );

          emitRuntimeEvent("final-settle-observation-started", {
            filePath,
            fileName: path.basename(filePath),
            replayHash: stored.replayHash || entry.lastFinalReplayHash || null,
            finalAccepted: stored.finalAccepted,
            finalStored: stored.finalStored,
            resultReady: stored.resultReady,
            settleWindowMs: runtimeConfig.finalSettleWindowMs,
            fingerprint: entry.lastFinalUploadedFingerprint,
            ...parseFingerprintParts(entry.lastFinalUploadedFingerprint),
          });
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

function shouldRecheckKnownFinalFingerprint(entry, fingerprint) {
  return Boolean(
    entry &&
      !entry.monitoring &&
      (entry.finalAccepted || entry.finalStored) &&
      entry.lastFinalUploadedFingerprint &&
      fingerprint &&
      fingerprint !== entry.lastFinalUploadedFingerprint
  );
}


async function scanRecentGrowingReplay(
  runtimeConfig,
  { emitCompletion = true } = {}
) {
  let entries;
  try {
    entries = await fs.promises.readdir(runtimeConfig.watchDir, { withFileTypes: true });
  } catch (error) {
    emitRuntimeEvent("watcher-error", { detail: `Initial replay scan failed: ${error.message}` });
    return false;
  }

  const cutoff = Date.now() - RECENT_LIVE_CANDIDATE_MS;
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(runtimeConfig.watchDir, entry.name);
    if (!shouldHandle(filePath, runtimeConfig)) continue;
    try {
      const stats = await fs.promises.stat(filePath);

      const fingerprint =
        `${stats.size}:${Math.floor(stats.mtimeMs)}`;

      const knownFinalChanged =
        shouldRecheckKnownFinalFingerprint(
          activeUploadState.get(filePath),
          fingerprint
        );

      if (
        stats.mtimeMs >= cutoff ||
        knownFinalChanged
      ) {
        candidates.push({
          filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          fingerprint,
        });
      }
    } catch {
      // A game may replace the file between directory scan and stat.
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

  //
  // A finalized replay may receive one late write after the monitor has
  // already exited. Native filesystem notifications are best-effort, and
  // the old recovery path only detected files that happened to be growing
  // during its 1.5-second sampling window.
  //
  // First compare every recent replay that has known final state against
  // the fingerprint we actually uploaded. A fingerprint divergence is
  // rechecked through resolveFinalReplayShortCircuit(), which performs the
  // stronger content-hash comparison:
  //
  //   same bytes, touched metadata -> normalize state and skip
  //   different bytes             -> reopen monitoring
  //
  for (const candidate of candidates) {
    const entry = activeUploadState.get(candidate.filePath);

    if (!shouldRecheckKnownFinalFingerprint(entry, candidate.fingerprint)) {
      continue;
    }

    const finalReplayShortCircuit = await resolveFinalReplayShortCircuit(
      candidate.filePath,
      entry,
      runtimeConfig,
      {
        fingerprint: candidate.fingerprint,
      }
    );

    if (finalReplayShortCircuit) {
      continue;
    }

    log(
      `Recovery scan found changed bytes after final storage for ${path.basename(
        candidate.filePath
      )}. Reopening replay monitoring.`,
      "warn"
    );

    emitRuntimeEvent("final-replay-change-recovered", {
      filePath: candidate.filePath,
      fileName: path.basename(candidate.filePath),
      reason: "known_final_fingerprint_changed",
      previousReplayHash: entry.lastFinalReplayHash || null,
      previousFinalFingerprint: entry.lastFinalUploadedFingerprint,
      fingerprint: candidate.fingerprint,
      fileSizeBytes: candidate.size,
      mtimeMs: Math.floor(candidate.mtimeMs),
      ...parseFingerprintParts(candidate.fingerprint),
    });

    await onFileDetected(
      "recovery-scan",
      candidate.filePath,
      runtimeConfig
    );

    return true;
  }

  //
  // Preserve the original conservative path for newly discovered replays
  // that have no prior in-memory final state.
  //
  for (const candidate of candidates.slice(0, 3)) {
    await sleep(LIVE_CANDIDATE_GROWTH_CHECK_MS);
    try {
      const next = await fs.promises.stat(candidate.filePath);
      if (next.size > candidate.size || next.mtimeMs > candidate.mtimeMs) {
        emitRuntimeEvent("midgame-replay-recovered", {
          fileName: path.basename(candidate.filePath),
          reason: "recent_replay_growing_on_attach",
          fileSizeBytes: next.size,
          mtimeMs: Math.floor(next.mtimeMs),
        });
        await onFileDetected("initial-scan", candidate.filePath, runtimeConfig);
        return true;
      }
    } catch {
      // Continue to the next conservative candidate.
    }
  }
  if (emitCompletion) {
    emitRuntimeEvent("initial-replay-scan-complete", {
      reason: candidates.length > 0 ? "recent_files_not_growing" : "no_recent_replays",
      found: candidates.length,
    });
  }

  return false;
}

async function runRecoveryScan(runtimeConfig) {
  if (
    !activeWatcher ||
    activeRuntimeStatus.activeReplay ||
    activeRecoveryScanInFlight
  ) {
    return false;
  }

  activeRecoveryScanInFlight = true;

  try {
    const recovered = await scanRecentGrowingReplay(runtimeConfig, {
      emitCompletion: false,
    });

    if (recovered) {
      log(
        "Recovery scan found replay bytes that require renewed monitoring.",
        "warn"
      );

      emitRuntimeEvent("watcher-recovery-scan-hit", {
        reason: "replay_change_recovered",
      });
    }

    return recovered;
  } catch (error) {
    log(
      `Recovery replay scan failed: ${error.message || error}`,
      "warn"
    );

    emitRuntimeEvent("watcher-recovery-scan-error", {
      detail: error.message || String(error),
    });

    return false;
  } finally {
    activeRecoveryScanInFlight = false;
  }
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
  return [
    `Uploaded ${state.uploaded}`,
    `archived ${state.archived}`,
    `parsed ${state.parsed}`,
    `result ready ${state.resultReady}`,
    `review routed ${state.reviewRouted}`,
    `skipped ${state.skipped}`,
    `failed ${state.failed}`,
  ].join(", ") + ".";
}

async function listImportCandidates(runtimeConfig, filePaths = null) {
  const supportedFiles = [];
  const skippedAtScan = [];
  let unsupported = 0;

  const scanStats = {
    scanPath: runtimeConfig.watchDir || "",
    maxScanDepth: IMPORT_SCAN_MAX_DEPTH,
    entriesSeen: 0,
    fileEntriesSeen: 0,
    folderEntriesSeen: 0,
    supportedCount: 0,
    unsupportedCount: 0,
    sampleEntries: [],
  };

  function rememberEntry(filePath, entry, depth) {
    if (scanStats.sampleEntries.length >= 20) {
      return;
    }

    scanStats.sampleEntries.push({
      name: entry?.name || path.basename(filePath),
      kind: entry?.isDirectory?.() ? "dir" : entry?.isFile?.() ? "file" : "other",
      depth,
      relativePath: path.relative(runtimeConfig.watchDir, filePath),
    });
  }

  if (Array.isArray(filePaths) && filePaths.length > 0) {
    const seen = new Set();

    for (const rawPath of filePaths) {
      const filePath = String(rawPath || "").trim();
      if (!filePath || seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);

      scanStats.entriesSeen += 1;

      if (!fs.existsSync(filePath)) {
        skippedAtScan.push(createImportItem(filePath, "skipped", "File is no longer on disk."));
        continue;
      }

      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        skippedAtScan.push(createImportItem(filePath, "skipped", "Not a replay file."));
        continue;
      }

      scanStats.fileEntriesSeen += 1;

      if (!shouldHandle(filePath, runtimeConfig)) {
        unsupported += 1;
        scanStats.unsupportedCount = unsupported;
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

    scanStats.supportedCount = supportedFiles.length;

    return {
      supportedFiles,
      unsupported,
      skippedAtScan,
      scanStats,
    };
  }

  async function scanDirectory(directoryPath, depth = 0) {
    const entries = await fs.promises.readdir(directoryPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const filePath = path.join(directoryPath, entry.name);
      scanStats.entriesSeen += 1;
      rememberEntry(filePath, entry, depth);

      if (entry.isDirectory()) {
        scanStats.folderEntriesSeen += 1;

        if (depth < IMPORT_SCAN_MAX_DEPTH && !entry.name.startsWith(".")) {
          await scanDirectory(filePath, depth + 1);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      scanStats.fileEntriesSeen += 1;

      if (!shouldHandle(filePath, runtimeConfig)) {
        unsupported += 1;
        scanStats.unsupportedCount = unsupported;
        continue;
      }

      const stats = await fs.promises.stat(filePath);
      supportedFiles.push({
        filePath,
        fileName: path.relative(runtimeConfig.watchDir, filePath),
        mtimeMs: stats.mtimeMs,
      });
    }
  }

  await scanDirectory(runtimeConfig.watchDir, 0);

  supportedFiles.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return left.mtimeMs - right.mtimeMs;
    }
    return left.fileName.localeCompare(right.fileName);
  });

  scanStats.supportedCount = supportedFiles.length;
  scanStats.unsupportedCount = unsupported;

  return {
    supportedFiles,
    unsupported,
    skippedAtScan,
    scanStats,
  };
}

async function getImportFileFacts(filePath, fingerprint = null) {
  const facts = {
    filePath,
    fileName: path.basename(filePath),
    fileSizeBytes: null,
    mtimeMs: null,
    fingerprint: fingerprint || null,
  };

  if (fingerprint) {
    Object.assign(facts, parseFingerprintParts(fingerprint));
  }

  try {
    if (fs.existsSync(filePath)) {
      const stats = await fs.promises.stat(filePath);
      facts.fileSizeBytes = stats.size;
      facts.mtimeMs = Math.floor(stats.mtimeMs);
    }
  } catch (error) {
    facts.statError = error.message || String(error);
  }

  return facts;
}

function buildBatchTelemetryPayload(state, patch = {}) {
  return {
    source: state.source,
    phase: state.phase,
    found: state.found,
    queued: state.queued,
    totalFiles: state.queued,
    unsupportedCount: state.unsupported,
    uploadedCount: state.uploaded,
    archivedCount: state.archived,
    parsedCount: state.parsed,
    resultReadyCount: state.resultReady,
    reviewRoutedCount: state.reviewRouted,
    skippedCount: state.skipped,
    failedCount: state.failed,
    currentIndex: state.currentIndex,
    currentFile: state.currentFile,
    percent: state.percent,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    summaryText: state.summaryText,
    scanPath: state.scanPath,
    maxScanDepth: state.maxScanDepth,
    entriesSeen: state.entriesSeen,
    fileEntriesSeen: state.fileEntriesSeen,
    folderEntriesSeen: state.folderEntriesSeen,
    sampleEntries: state.sampleEntries,
    ...patch,
  };
}

async function emitBatchFileEvent(eventType, state, filePath, patch = {}) {
  const facts = await getImportFileFacts(filePath, patch.fingerprint || null);
  emitRuntimeEvent(eventType, buildBatchTelemetryPayload(state, {
    ...facts,
    ...patch,
  }));
}


async function importHistoricalReplays(config = {}, options = {}, hooks = {}) {
  setRuntimeHooks(hooks);

  const runtimeConfig = buildRuntimeConfig(config);
  const validationError = getRuntimeValidationError(runtimeConfig);
  if (validationError) {
    emitRuntimeEvent("batch-upload-failed", {
      phase: "validation",
      reason: "validation_error",
      detail: validationError,
    });
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
    archived: 0,
    parsed: 0,
    resultReady: 0,
    reviewRouted: 0,
    failed: 0,
    unsupported: 0,
    currentFile: "",
    currentIndex: 0,
    failedItems: [],
    skippedItems: [],
    recentItems: [],
    summaryText: "",
    scanPath: runtimeConfig.watchDir,
    maxScanDepth: IMPORT_SCAN_MAX_DEPTH,
    entriesSeen: 0,
    fileEntriesSeen: 0,
    folderEntriesSeen: 0,
    sampleEntries: [],
  };

  emitRuntimeEvent("batch-upload-started", buildBatchTelemetryPayload(state, {
    watchDir: runtimeConfig.watchDir,
    scanPath: runtimeConfig.watchDir,
    explicitFileCount: Array.isArray(options.filePaths) ? options.filePaths.length : null,
  }));

  emitImportProgress(state, hooks);

  const { supportedFiles, unsupported, skippedAtScan, scanStats } = await listImportCandidates(
    runtimeConfig,
    options.filePaths || null
  );

  state.found = supportedFiles.length;
  state.unsupported = unsupported;
  state.scanPath = scanStats?.scanPath || runtimeConfig.watchDir;
  state.maxScanDepth = Number.isFinite(scanStats?.maxScanDepth)
    ? scanStats.maxScanDepth
    : IMPORT_SCAN_MAX_DEPTH;
  state.entriesSeen = Number.isFinite(scanStats?.entriesSeen) ? scanStats.entriesSeen : 0;
  state.fileEntriesSeen = Number.isFinite(scanStats?.fileEntriesSeen)
    ? scanStats.fileEntriesSeen
    : 0;
  state.folderEntriesSeen = Number.isFinite(scanStats?.folderEntriesSeen)
    ? scanStats.folderEntriesSeen
    : 0;
  state.sampleEntries = Array.isArray(scanStats?.sampleEntries) ? scanStats.sampleEntries : [];

  emitRuntimeEvent("batch-upload-scanned", buildBatchTelemetryPayload(state, {
    supportedCount: supportedFiles.length,
    skippedAtScanCount: skippedAtScan.length,
  }));

  const queue = [];
  for (const candidate of supportedFiles) {
    const entry = getStateEntry(candidate.filePath);

    if (entry.monitoring) {
      state.skipped += 1;
      const detail = "Already being watched live. Let the watcher finish the current replay.";
      pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", detail));
      await emitBatchFileEvent("batch-upload-file-skipped", state, candidate.filePath, {
        reason: "monitoring",
        detail,
      });
      continue;
    }

    if (entry.importing) {
      state.skipped += 1;
      const detail = "Already queued for import in this session.";
      pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", detail));
      await emitBatchFileEvent("batch-upload-file-skipped", state, candidate.filePath, {
        reason: "already_importing",
        detail,
      });
      continue;
    }

    queue.push(candidate);
  }

  for (const skippedItem of skippedAtScan) {
    state.skipped += 1;
    pushImportItem(state.skippedItems, skippedItem);
    await emitBatchFileEvent("batch-upload-file-skipped", state, skippedItem.filePath, {
      reason: "scan_skip",
      detail: skippedItem.detail,
      status: skippedItem.status,
    });
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
    updateImportPercent(state);
    emitImportProgress(state, hooks);

    emitRuntimeEvent("batch-upload-finished", buildBatchTelemetryPayload(state, {
      reason: "empty_queue",
    }));

    return cloneImportState(state);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    const entry = getStateEntry(candidate.filePath);

    state.currentIndex = index + 1;
    state.currentFile = candidate.fileName;
    state.phase = "uploading";
    emitImportProgress(state, hooks);

    await emitBatchFileEvent("batch-upload-file-started", state, candidate.filePath, {
      reason: "queued",
    });

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

      await emitBatchFileEvent("batch-upload-file-skipped", state, candidate.filePath, {
        reason: stability.reason || "unstable",
        detail: reason,
        fingerprint: stability.fingerprint || null,
      });

      updateImportPercent(state);
      emitImportProgress(state, hooks);
      continue;
    }

    await emitBatchFileEvent("batch-upload-file-stable", state, candidate.filePath, {
      reason: "stable",
      fingerprint: stability.fingerprint,
    });

    if (
      (entry.finalAccepted || entry.finalStored) &&
      entry.lastFinalUploadedFingerprint === stability.fingerprint
    ) {
      state.skipped += 1;
      const detail = "Already imported in this app session.";
      pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", detail));
      pushImportItem(state.recentItems, createImportItem(candidate.filePath, "skipped", detail));

      await emitBatchFileEvent("batch-upload-file-skipped", state, candidate.filePath, {
        reason: "already_finalized_in_session",
        detail,
        fingerprint: stability.fingerprint,
      });

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
        provenance: WATCHER_PROVENANCE_HISTORICAL_IMPORT,
      });

      if (!result.ok) {
        state.failed += 1;
        const detail = result.errorMessage || "Upload failed.";

        pushImportItem(state.failedItems, createImportItem(candidate.filePath, "failed", detail));
        pushImportItem(state.recentItems, createImportItem(candidate.filePath, "failed", detail));

        await emitBatchFileEvent("batch-upload-file-failed", state, candidate.filePath, {
          reason: "upload_failed",
          detail,
          fingerprint: stability.fingerprint,
          resultType: result.resultType || null,
          responseStatus: result.responseStatus || null,
        });
      } else {
        if (result.archived) state.archived += 1;
        if (result.parsed) state.parsed += 1;
        if (result.resultReady) state.resultReady += 1;
        if (result.reviewRouted) state.reviewRouted += 1;

        const receiptDetail = buildReplayReceiptDetail(candidate.fileName, result, {
          isFinal: true,
        });

        if (result.resultType === "duplicate") {
          state.skipped += 1;
          const detail = result.resultReady
            ? `${candidate.fileName} result already filed.`
            : receiptDetail;

          pushImportItem(state.skippedItems, createImportItem(candidate.filePath, "skipped", detail));
          pushImportItem(state.recentItems, createImportItem(candidate.filePath, "skipped", detail));

          await emitBatchFileEvent("batch-upload-file-skipped", state, candidate.filePath, {
            reason: "duplicate",
            detail,
            fingerprint: stability.fingerprint,
            resultType: result.resultType,
            replayHash: result.replayHash || null,
            archived: Boolean(result.archived),
            parsed: Boolean(result.parsed),
            resultReady: Boolean(result.resultReady),
            reviewRouted: Boolean(result.reviewRouted),
          });
        } else {
          state.uploaded += 1;
          const detail = receiptDetail;
          const itemStatus = result.resultReady ? "result_ready" : "review_routed";

          pushImportItem(state.recentItems, createImportItem(candidate.filePath, itemStatus, detail));

          await emitBatchFileEvent("batch-upload-file-succeeded", state, candidate.filePath, {
            reason: result.resultReady ? "result_ready" : "review_routed",
            detail,
            fingerprint: stability.fingerprint,
            resultType: result.resultType || "uploaded",
            replayHash: result.replayHash || null,
            archived: Boolean(result.archived),
            parsed: Boolean(result.parsed),
            resultReady: Boolean(result.resultReady),
            reviewRouted: Boolean(result.reviewRouted),
          });
        }
      }
    } catch (error) {
      state.failed += 1;
      const detail = error.message || String(error) || "Unexpected batch upload failure.";

      pushImportItem(state.failedItems, createImportItem(candidate.filePath, "failed", detail));
      pushImportItem(state.recentItems, createImportItem(candidate.filePath, "failed", detail));

      await emitBatchFileEvent("batch-upload-file-failed", state, candidate.filePath, {
        reason: "exception",
        detail,
        fingerprint: stability.fingerprint,
      });
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

  emitRuntimeEvent("batch-upload-finished", buildBatchTelemetryPayload(state, {
    reason: state.failed > 0 ? "complete_with_failures" : "complete",
  }));

  return cloneImportState(state);
}


function stopWatching() {
  if (activeRecoveryScanTimer) {
    clearInterval(activeRecoveryScanTimer);
    activeRecoveryScanTimer = null;
  }

  activeRecoveryScanInFlight = false;

  if (activeWatcher) {
    try {
      activeWatcher.close();
      log("Closed replay directory watcher handle.");
    } catch (error) {
      log(`Failed closing watcher: ${error.message}`, "error");
    }
  }

  activeWatcher = null;
  activeRuntimeStatus.monitorAttached = false;
  activeUploadState = new Map();
  activeUploadKeys = new Set();
  activeSettlementStatePath = null;
  activePreferredUploadTargetBaseUrl = null;
  emitRuntimeEvent("watching-stopped", {});
}

function startWatching(config = {}, hooks = {}) {
  stopWatching();
  setRuntimeHooks(hooks);

  const runtimeConfig = buildRuntimeConfig(config);
  const folder = inspectReplayFolder(runtimeConfig.watchDir);
  activeRuntimeStatus = {
    ...createRuntimeStatus(),
    folderValid: folder.valid,
    folderKind: folder.kind,
    folderLabel: folder.label,
    lastFolderActivityAt: folder.latestReplayModifiedAt,
  };
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

  activeSettlementStatePath =
    runtimeConfig.settlementStatePath ||
    null;

  const restoredSettlementEntries =
    loadSettlementState(
      activeSettlementStatePath,
      runtimeConfig.watchDir
    );

  log(
    `Restored ${restoredSettlementEntries} persisted final replay state entr${
      restoredSettlementEntries === 1
        ? "y"
        : "ies"
    }.`
  );

  emitRuntimeEvent(
    "settlement-state-restored",
    {
      restoredEntries:
        restoredSettlementEntries,
      persistenceEnabled:
        Boolean(
          activeSettlementStatePath
        ),
    }
  );

  log(`Watching directory: ${runtimeConfig.watchDir}`);
  log(
    `Upload endpoints: ${runtimeConfig.uploadTargets
      .map((target) => target.uploadUrl)
      .join(" -> ")}`
  );
  log(`Watcher UID: ${runtimeConfig.watcherUid}`);
  log(`Replay extensions: ${Array.from(runtimeConfig.watchExtensions).join(", ")}`);

  emitRuntimeEvent("watching-started", {
    watchDir: runtimeConfig.watchDir,
    uploadTargets: runtimeConfig.uploadTargets.map((target) => target.uploadUrl),
  });

  try {
    activeWatcher = fs.watch(
      runtimeConfig.watchDir,
      {
        persistent: true,
      },
      (eventType, rawFileName) => {
        if (!activeWatcher) {
          return;
        }

        // Some platforms may report a directory-level event without a
        // filename. The conservative recovery scan handles that case
        // without retaining watchers on every historical replay.
        if (!rawFileName) {
          if (!activeRuntimeStatus.activeReplay) {
            void scanRecentGrowingReplay(runtimeConfig);
          }
          return;
        }

        const fileName = Buffer.isBuffer(rawFileName)
          ? rawFileName.toString("utf8")
          : String(rawFileName);

        const filePath = path.join(runtimeConfig.watchDir, fileName);

        if (!shouldHandle(filePath, runtimeConfig)) {
          return;
        }

        // A rename event is also emitted when a file disappears.
        // Deleted replay files are not upload candidates.
        if (eventType === "rename" && !fs.existsSync(filePath)) {
          return;
        }

        const replayEventType = eventType === "rename" ? "add" : "change";

        void onFileDetected(
          replayEventType,
          filePath,
          runtimeConfig
        ).catch((error) => {
          log(
            `Replay directory event failed for ${fileName}: ${error.message || error}`,
            "error"
          );
          emitRuntimeEvent("watcher-error", {
            filePath,
            fileName,
            detail: error.message || String(error),
          });
        });
      }
    );
  } catch (error) {
    log(`Failed attaching replay directory watcher: ${error.message}`, "error");
    emitRuntimeEvent("watcher-error", {
      detail: error.message,
    });
    activeWatcher = null;
    return null;
  }

  activeWatcher.on("error", (error) => {
    log(`Watcher error: ${error.message}`, "error");
    emitRuntimeEvent("watcher-error", {
      detail: error.message,
    });
  });

  log("Native replay directory watcher is ready and listening for replay events.");

  emitRuntimeEvent("watcher-ready", {
    folderKind: folder.kind,
    folderLabel: folder.label,
    latestReplayBasename: folder.latestReplayBasename,
    latestReplayModifiedAt: folder.latestReplayModifiedAt,
  });

  void scanRecentGrowingReplay(runtimeConfig);

  activeRecoveryScanTimer = setInterval(() => {
    void runRecoveryScan(runtimeConfig);
  }, runtimeConfig.recoveryScanIntervalMs);

  log(
    `Replay recovery watchdog armed every ${Math.round(
      runtimeConfig.recoveryScanIntervalMs / 1000
    )}s for missed CrossOver/native directory events.`
  );

  return activeWatcher;
}

module.exports = {
  buildPersistedSettlementState,
  buildRuntimeConfig,
  restorePersistedSettlementState,
  shouldRecheckKnownFinalFingerprint,
  signWatcherProvenance,
  buildReplayReceiptDetail,
  classifyUploadResult,
  classifyReplayAcceptance,
  createReplayUploadSnapshot,
  getDefaultReplayDir,
  detectReplayFolder,
  inspectReplayFolder,
  getRuntimeStatus: () => ({ ...activeRuntimeStatus }),
  getFileFingerprint,
  getRetryDelayMs: (
    attempt,
    config = {},
    options = {}
  ) =>
    getRetryDelayMsFactory(
      buildRuntimeConfig(config),
      attempt,
      options
    ),
  parseRetryAfterMs,
  readRetryAfterHeader,
  getReplayContentHash,
  getRuntimeValidationError,
  getSupportedReplayExtensions,
  importHistoricalReplays,
  isRetryableUploadError,
  monitorReplayFile,
  resolveFinalReplayShortCircuit,
  shouldHandle,
  summarizeUploadResponse,
  startWatching,
  stopWatching,
};
