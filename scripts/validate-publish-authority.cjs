"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Preflight for the manually authorized release-publishing lane.
 *
 * The runner IDs, digests, source SHAs and VERSION in the workflow are sealed
 * release-campaign inputs, NOT values to silently infer from a new checkout.
 * A future Watcher version cannot reuse an old campaign's pinned publication.
 */
function validatePublishAuthority({ packageVersion, lockVersion, rootLockVersion, env }) {
  const version = String(env.VERSION || "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("STOP: VERSION must be an explicit stable semantic version");
  }
  for (const [label, value] of [
    ["package.json", packageVersion],
    ["package-lock.json", lockVersion],
    ["package-lock.json root", rootLockVersion],
  ]) {
    if (value !== version) {
      throw new Error(
        `STOP: pinned release VERSION ${version} does not match ${label} version ${String(value)}; do not reuse previous release receipts`,
      );
    }
  }
  for (const field of ["RUNTIME_SOURCE_SHA", "BUILD_SOURCE_SHA"]) {
    if (!/^[0-9a-f]{40}$/.test(String(env[field] || ""))) {
      throw new Error(`STOP: ${field} requires a pinned 40-digit source SHA`);
    }
  }
  for (const field of ["WINDOWS_RUN_ID", "NONWINDOWS_RUN_ID"]) {
    if (!/^[1-9][0-9]*$/.test(String(env[field] || "")) ||
        !Number.isSafeInteger(Number(env[field]))) {
      throw new Error(`STOP: ${field} requires an explicit positive workflow run ID`);
    }
  }
  if (String(env.WINDOWS_RUN_ID) === String(env.NONWINDOWS_RUN_ID)) {
    throw new Error("STOP: Windows and non-Windows signing/build receipts must come from distinct runs");
  }
  return version;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const version = validatePublishAuthority({
    packageVersion: pkg.version,
    lockVersion: lock.version,
    rootLockVersion: lock.packages?.[""]?.version,
    env: process.env,
  });
  process.stdout.write(
    `Pinned publication version ${version} matches package and lock authority; runner SHA and binary digest verification remains mandatory.\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { validatePublishAuthority };
