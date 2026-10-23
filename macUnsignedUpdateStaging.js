"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { isAuthenticatedMacReleaseProof } = require("./macUnsignedUpdateManifest");

// A disconnected pre-install staging primitive. It never extracts, installs,
// starts, quits, or replaces the Watcher, and never receives wallet/API keys.
const STAGE_NAME = "watcher-update-staging";
const DEFAULT_TIMEOUT_MS = 120_000;

function stop(reason) {
  const error = new Error("Mac Watcher staging refused: " + reason);
  error.code = "AOE2_MAC_STAGE_REFUSED";
  throw error;
}

async function ensureSafeOwnedDirectory(dir, { privateOnly = false } = {}) {
  if (typeof dir !== "string" || !path.isAbsolute(dir) ||
      dir.includes("\0") || path.normalize(dir) !== dir) stop("invalid_directory");
  const stat = await fs.promises.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) stop("directory_is_not_real");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    stop("directory_wrong_owner");
  }
  if (stat.mode & 0o022) stop("directory_other_writer");
  if (privateOnly && (stat.mode & 0o077)) stop("directory_not_private");
}

function requestOfficialHttpsArchive({ url, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const timeout = Number.isInteger(timeoutMs) && timeoutMs >= 1000 &&
    timeoutMs <= DEFAULT_TIMEOUT_MS ? timeoutMs : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    // URL has already been authenticated by the offline-signed manifest.
    // No cookies, bearer tokens or Watcher pairing credentials are forwarded.
    const req = https.get(url, {
      headers: {
        "Accept": "application/zip, application/octet-stream",
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(timeout),
    }, response => {
      resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: response,
      });
    });
    req.once("error",reject);
  });
}

async function stageVerifiedMacArchive({
  verifiedManifest,
  userDataDir,
  openResponse = requestOfficialHttpsArchive,
} = {}) {
  if (!isAuthenticatedMacReleaseProof(verifiedManifest)) stop("unauthenticated_release");
  if (typeof openResponse !== "function") stop("invalid_transport");
  if (!fs.constants.O_NOFOLLOW) stop("no_nofollow_support");

  await ensureSafeOwnedDirectory(userDataDir);
  const parent = path.join(userDataDir, STAGE_NAME);
  try {
    await fs.promises.mkdir(parent, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await ensureSafeOwnedDirectory(parent, {privateOnly:true});

  const artifact = verifiedManifest.manifest.artifact;
  const dir = await fs.promises.mkdtemp(path.join(parent,"candidate-"));
  let handle, response;
  try {
    await ensureSafeOwnedDirectory(dir, {privateOnly:true});
    const partial = path.join(dir,"archive.partial");
    const archivePath = path.join(dir,artifact.name);
    // 0700 parent + exclusive, no-follow, 0600 destination. A validated
    // manifest name is flat, so archivePath cannot escape the stage.
    handle = await fs.promises.open(partial,
      fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);

    response = await openResponse({url:artifact.url,timeoutMs:DEFAULT_TIMEOUT_MS});
    if (!response || response.statusCode !== 200) stop("status_or_redirect");
    const headers = response.headers || {};
    const mime=String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!["application/zip","application/octet-stream","application/x-zip-compressed"].includes(mime)) {
      stop("unexpected_media_type");
    }
    if (headers["content-encoding"] &&
        String(headers["content-encoding"]).toLowerCase() !== "identity") {
      stop("compressed_transfer");
    }
    const reported = headers["content-length"];
    if (reported !== undefined && (!/^\d+$/.test(String(reported)) ||
        Number(reported) !== artifact.bytes)) stop("content_length_mismatch");
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
      stop("missing_response_stream");
    }
    const hash = crypto.createHash("sha256");
    let size = 0;
    for await (const chunk of response.body) {
      if (!Buffer.isBuffer(chunk)) stop("nonbinary_response");
      size += chunk.length;
      if (size > artifact.bytes) stop("oversize_transfer");
      hash.update(chunk);
      let offset=0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk,offset,chunk.length-offset,null);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) stop("write_failed");
        offset += bytesWritten;
      }
    }
    if (size !== artifact.bytes) stop("truncated_transfer");
    const checksum=hash.digest();
    if (!crypto.timingSafeEqual(checksum,Buffer.from(artifact.sha256,"hex"))) {
      stop("artifact_hash_mismatch");
    }
    await handle.sync();
    await handle.close();
    handle=null;
    await fs.promises.rename(partial,archivePath);
    const result = {archivePath, stageDir:dir, bytes:size,
      sha256:checksum.toString("hex"), version:verifiedManifest.manifest.version};
    return Object.freeze(result);
  } catch (error) {
    if (response?.body && typeof response.body.destroy === "function") {
      response.body.destroy();
    }
    if (handle) await handle.close().catch(()=>{});
    await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}

module.exports = { stageVerifiedMacArchive, requestOfficialHttpsArchive };
