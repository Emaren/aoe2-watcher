"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePublishAuthority } = require("../scripts/validate-publish-authority.cjs");

const valid = {
  packageVersion: "1.6.4",
  lockVersion: "1.6.4",
  rootLockVersion: "1.6.4",
  env: {
    VERSION: "1.6.4",
    RUNTIME_SOURCE_SHA: "a".repeat(40),
    BUILD_SOURCE_SHA: "b".repeat(40),
    WINDOWS_RUN_ID: "37042601127",
    NONWINDOWS_RUN_ID: "37042597135",
  },
};

function configured(overrides = {}) {
  return {
    ...valid,
    ...overrides,
    env: { ...valid.env, ...overrides.env },
  };
}

test("release publication accepts exact package/lock/pins", () => {
  assert.equal(validatePublishAuthority(configured()), "1.6.4");
});

test("1.6.4 candidate cannot reuse the pinned 1.6.3 campaign", () => {
  assert.throws(
    () => validatePublishAuthority(configured({ env: { VERSION: "1.6.3" } })),
    /does not match package\.json/,
  );
});

test("package-lock root and top-level authority must agree", () => {
  assert.throws(
    () => validatePublishAuthority(configured({ lockVersion: "1.6.3" })),
    /package-lock\.json version/,
  );
  assert.throws(
    () => validatePublishAuthority(configured({ rootLockVersion: "1.6.3" })),
    /package-lock\.json root version/,
  );
});

test("release versions must be stable and explicit", () => {
  for (const version of ["", "1.6.4-rc.1", "v1.6.4", "latest"]) {
    assert.throws(
      () => validatePublishAuthority(configured({ env: { VERSION: version } })),
      /stable semantic version/,
    );
  }
});

test("workflow run IDs must be real, distinct numeric pins", () => {
  for (const runId of ["", "0", "abc", "9007199254740993"]) {
    assert.throws(
      () => validatePublishAuthority(configured({ env: { WINDOWS_RUN_ID: runId } })),
      /positive workflow run ID/,
    );
  }
  assert.throws(
    () => validatePublishAuthority(configured({
      env: { WINDOWS_RUN_ID: "37042597135" },
    })),
    /distinct runs/,
  );
});

test("both source SHA pins must be concrete 40-character hashes", () => {
  for (const field of ["RUNTIME_SOURCE_SHA", "BUILD_SOURCE_SHA"]) {
    assert.throws(
      () => validatePublishAuthority(configured({ env: { [field]: "unknown" } })),
      /pinned 40-digit source SHA/,
    );
  }
});
