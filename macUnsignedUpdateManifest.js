"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const trustedProofs = new WeakSet();
const { isStableNewerVersion } = require("./updatePolicy");

// This is a **disconnected policy primitive**, NOT a working installer.
// In production the public key MUST be an immutable, independently pinned
// build-time constant. NEVER accept a public key obtained from the manifest,
// release site, network response, runtime configuration, or user input.
const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_SIGNED_BYTES = 8 * 1024;
const MIN_ARCHIVE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(["aoe2war.com"]);

function deny(reason) {
  return { verified: false, reason };
}

function plainObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(obj, fields) {
  return plainObject(obj) &&
    Object.keys(obj).length === fields.length &&
    fields.every(key => Object.hasOwn(obj, key));
}

function canonicalBase64(value, maxDecodedBytes) {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > Math.ceil(maxDecodedBytes * 4 / 3) + 8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maxDecodedBytes ||
      bytes.toString("base64") !== value) return null;
  return bytes;
}

function validateManifest(value, { currentVersion, targetArch }) {
  if (!exactFields(value, ["schema", "channel", "platform", "arch", "version", "sourceSha", "artifact"])) {
    return deny("manifest_fields");
  }
  if (value.schema !== 1 || value.channel !== "stable" || value.platform !== "darwin" ||
      value.arch !== targetArch || !["arm64", "x64"].includes(value.arch)) {
    return deny("platform_or_channel");
  }
  if (!isStableNewerVersion(value.version, currentVersion)) return deny("non_newer_version");
  if (typeof value.sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceSha)) {
    return deny("source_identity");
  }
  const art=value.artifact;
  if (!exactFields(art,["name", "bytes", "sha256", "url"])) return deny("artifact_fields");
  if (typeof art.bytes !== "number" || !Number.isSafeInteger(art.bytes) ||
      art.bytes < MIN_ARCHIVE_BYTES || art.bytes > MAX_ARCHIVE_BYTES ||
      typeof art.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(art.sha256)) {
    return deny("artifact_size_or_hash");
  }
  const expected = `AoE2HDBets Watcher-${value.version}-${value.arch}.zip`;
  if (art.name !== expected) return deny("artifact_name");
  let uri;
  try { uri = new URL(art.url); } catch { return deny("artifact_url"); }
  if (uri.protocol !== "https:" || !ALLOWED_HOSTS.has(uri.hostname) ||
      uri.username || uri.password || uri.port || uri.search || uri.hash ||
      !uri.pathname.startsWith("/downloads/") ||
      uri.pathname.includes("%2f") || uri.pathname.includes("%2F") ||
      uri.pathname.includes("%5c") || uri.pathname.includes("%5C")) {
    return deny("artifact_origin");
  }
  let lastSegment;
  try { lastSegment = decodeURIComponent(uri.pathname.split("/").pop()); }
  catch { return deny("artifact_path"); }
  if (lastSegment !== expected || uri.pathname.includes("..") || uri.pathname.includes("//")) {
    return deny("artifact_path");
  }
  return { verified:true, reason:null, manifest:value };
}

function verifySignedMacReleaseEnvelope({
  envelopeBytes,
  currentVersion,
  targetArch = "arm64",
  pinnedPublicKeyPem,
} = {}) {
  if (!Buffer.isBuffer(envelopeBytes) || envelopeBytes.length === 0 ||
      envelopeBytes.length > MAX_ENVELOPE_BYTES) return deny("envelope_size");
  let envelope;
  try { envelope = JSON.parse(envelopeBytes.toString("utf8")); }
  catch { return deny("envelope_json"); }
  if (!exactFields(envelope, ["payload", "signature"])) return deny("envelope_fields");
  const payload = canonicalBase64(envelope.payload, MAX_SIGNED_BYTES);
  const signature = canonicalBase64(envelope.signature, 64);
  if (!payload || !signature || signature.length !== 64) return deny("envelope_encoding");
  let key;
  try {
    key = crypto.createPublicKey(pinnedPublicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return deny("unsupported_key");
  } catch { return deny("missing_or_invalid_pinned_key"); }
  // Validate signature BEFORE treating any embedded URLs or versions as data.
  if (!crypto.verify(null, payload, key, signature)) return deny("signature_invalid");
  let manifest;
  const text=payload.toString("utf8");
  try { manifest=JSON.parse(text); }
  catch { return deny("payload_json"); }
  // Require a unique and reproducible wire representation. This prevents
  // duplicate-field ambiguity and noncanonical signed JSON variants.
  if (!plainObject(manifest) || JSON.stringify(manifest) !== text) {
    return deny("noncanonical_payload");
  }
  const result = validateManifest(manifest, {currentVersion,targetArch});
  if (!result.verified) return result;
  // Authenticated release identity must not be mutable after verification or
  // forgeable through an ordinary object with {verified:true}.
  Object.freeze(result.manifest.artifact);
  Object.freeze(result.manifest);
  Object.freeze(result);
  trustedProofs.add(result);
  return result;
}

function verifyDownloadedArtifactBytes(verifiedManifest, bytes) {
  if (!trustedProofs.has(verifiedManifest) || !Buffer.isBuffer(bytes)) return false;
  const artifact=verifiedManifest.manifest.artifact;
  if (bytes.length !== artifact.bytes) return false;
  const digest=crypto.createHash("sha256").update(bytes).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest,"hex"),Buffer.from(artifact.sha256,"hex"));
}

// Stream archive verification through a no-follow file handle. Never load a
// 100+MB Electron update archive into the process heap merely to hash it.
// Caller still must enforce a private, ownership-checked staging directory,
// bounded downloader and archive extraction safety before replacement.
async function verifyDownloadedArtifactFile(verifiedManifest, filePath) {
  if (!trustedProofs.has(verifiedManifest) ||
      typeof filePath !== "string" || filePath.includes("\0") ||
      !fs.constants.O_NOFOLLOW) return false;
  const artifact = verifiedManifest.manifest.artifact;
  let handle;
  try {
    handle = await fs.promises.open(
      filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== artifact.bytes) return false;
    const hash = crypto.createHash("sha256");
    let size = 0;
    for await (const block of handle.createReadStream({autoClose:false})) {
      size += block.length;
      if (size > artifact.bytes) return false;
      hash.update(block);
    }
    if (size !== artifact.bytes) return false;
    const digest = hash.digest();
    return crypto.timingSafeEqual(
      digest, Buffer.from(artifact.sha256,"hex")
    );
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function isAuthenticatedMacReleaseProof(proof) {
  return proof !== null && typeof proof === "object" && trustedProofs.has(proof);
}

module.exports = {
  verifySignedMacReleaseEnvelope,
  verifyDownloadedArtifactBytes,
  verifyDownloadedArtifactFile,
  isAuthenticatedMacReleaseProof,
};
