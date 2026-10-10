"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "sign-windows-watcher.yml"),
  "utf8",
);

test("protected Windows signing workflow never signs on pull requests", () => {
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^    branches:\s*\n      - main$/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /azure\/artifact-signing-action@v1/);
});

test("both final signed executables must be validated before publication artifact upload", () => {
  assert.match(workflow, /AoE2HDBets Watcher Setup \$version\.exe/);
  assert.match(workflow, /AoE2HDBets Watcher \$version\.exe/);
  assert.match(workflow, /\$files\.Count -ne \$expectedNames\.Count/);
  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /SignatureStatus\]::Valid/);
  assert.match(workflow, /TimeStamperCertificate/);
  assert.match(workflow, /Get-FileHash -Path \$file\.FullName -Algorithm SHA256/);
  assert.match(workflow, /build\/SIGNED_WINDOWS_SHA256\.txt/);
  const signPos = workflow.indexOf("name: Sign Windows EXEs with Azure Artifact Signing");
  const verifyPos = workflow.indexOf("name: Verify signed and timestamped Windows release binaries");
  const uploadPos = workflow.indexOf("name: Upload signed EXEs");
  assert.ok(signPos >= 0 && verifyPos > signPos && uploadPos > verifyPos);
});
