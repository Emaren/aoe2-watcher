const test = require("node:test");
const assert = require("node:assert/strict");

async function moduleUnderTest() {
  return import("../scripts/sync-release-docs.mjs");
}

test("promotes the current candidate section to a public release", async () => {
  const { rewriteReadme, publicReleaseParagraph } = await moduleUnderTest();
  const source = [
    "# aoe2-watcher",
    "",
    "## v1.5.12 release candidate",
    "",
    "Watcher 1.5.12 adds folder recovery.",
    "",
    "The source version is `1.5.12`, but public artifacts remain `1.5.11`.",
    "",
    "## v1.5.11 release candidate",
    "",
    "Older release.",
    "",
  ].join("\n");
  const updated = rewriteReadme(source, "1.5.12");
  assert.match(updated, /## v1\.5\.12 public release/);
  assert.ok(updated.includes(publicReleaseParagraph("1.5.12")));
  assert.match(updated, /## v1\.5\.11 release candidate/);
});
test("promotes a certified pending-publication section without discarding audit prose", async () => {
  const { rewriteReadme, publicReleaseParagraph } = await moduleUnderTest();
  const source = [
    "# aoe2-watcher",
    "",
    "## v1.6.2 certified release — public publication pending",
    "",
    "Watcher 1.6.2 has completed certification but public publication is pending.",
    "",
    "The detailed resource-profile and renderer-health engineering evidence stays here.",
    "",
    "A second detailed paragraph must survive the lifecycle transition.",
    "",
    "The five principal user-facing bytes are bound by SHA-256 in the certification manifest. Public app metadata must stay on 1.6.1 until the owner publishes these exact bytes.",
    "",
    "## v1.6.1 public release",
    "",
    "Previous release.",
    "",
  ].join("\n");

  const updated = rewriteReadme(source, "1.6.2");
  assert.match(updated, /## v1\.6\.2 public release/);
  assert.ok(updated.includes(publicReleaseParagraph("1.6.2")));
  assert.match(
    updated,
    /The detailed resource-profile and renderer-health engineering evidence stays here\./,
  );
  assert.match(
    updated,
    /A second detailed paragraph must survive the lifecycle transition\./,
  );
  assert.doesNotMatch(updated, /certified release — public publication pending/);
  assert.doesNotMatch(updated, /Public app metadata must stay/);
  assert.match(
    updated,
    /immutable `v1\.6\.2` public release inventory has been verified/,
  );
  assert.doesNotMatch(
    updated,
    /Watcher 1\.6\.1 is the current public release\./,
  );
});

test("an already-public release stays current while older current claims are demoted", async () => {
  const { rewriteReadme } = await moduleUnderTest();
  const source = [
    "# aoe2-watcher",
    "",
    "## v1.6.1 public release",
    "",
    "Watcher 1.6.1 is the current public release. Richer provenance stays here.",
    "",
    "## v1.6.0 public release",
    "",
    "Watcher 1.6.0 is the current public release. Historical detail stays here.",
    "",
  ].join("\n");

  const updated = rewriteReadme(source, "1.6.1");
  assert.match(updated, /Watcher 1\.6\.1 is the current public release\./);
  assert.match(updated, /Watcher 1\.6\.0 was a prior public release\./);
  assert.match(updated, /Historical detail stays here\./);
  assert.equal(rewriteReadme(updated, "1.6.1"), updated);
});

test("requires the complete five-artifact public inventory", async () => {
  const { canonicalAssets, releaseInventoryComplete } = await moduleUnderTest();
  const version = "1.5.12";
  const complete = {
    tagName: `v${version}`,
    assets: canonicalAssets(version).map((name) => ({ name })),
  };
  assert.equal(releaseInventoryComplete(complete, version), true);

  const incomplete = {
    ...complete,
    assets: complete.assets.slice(0, -1),
  };
  assert.equal(releaseInventoryComplete(incomplete, version), false);
  assert.equal(
    releaseInventoryComplete({ ...complete, tagName: "v1.5.11" }, version),
    false,
  );
});

test("public release rewrite is idempotent", async () => {
  const { rewriteReadme } = await moduleUnderTest();
  const source = [
    "# aoe2-watcher",
    "",
    "## v9.9.9 release candidate",
    "",
    "Watcher 9.9.9 adds a bounded release behavior.",
    "",
    "The source version is `9.9.9`, but public artifacts remain `9.9.8`.",
    "",
    "## v9.9.8 public release",
    "",
    "Older release.",
    "",
  ].join("\n");

  const once = rewriteReadme(source, "9.9.9");
  const twice = rewriteReadme(once, "9.9.9");
  assert.equal(twice, once);
});

test("recognizes the dated 1.6.5 integration-candidate format without losing War Room limitations", async () => {
  const { rewriteReadme, publicReleaseParagraph } = await moduleUnderTest();
  const source = [
    "# aoe2-watcher",
    "",
    "## Watcher 1.6.5 — production integration candidate (October 19, 2026)",
    "",
    "This candidate has not yet completed publication.",
    "Watcher 1.6.4 is the current public release.",
    "The candidate preserves legacy Replay Truth: it does not retroactively decide unknown games.",
    "",
    "War Room uses the shared recorder. The paired website-profile avatar API is not yet live.",
    "",
    "## v1.6.3 public release (historical)",
    "",
    "Watcher 1.6.3 was a prior public release.",
    "",
  ].join("\n");

  const updated = rewriteReadme(source, "1.6.5");
  assert.match(updated, /## v1\.6\.5 public release/);
  assert.ok(updated.includes(publicReleaseParagraph("1.6.5")));
  assert.doesNotMatch(updated, /This candidate has not yet completed publication/);
  assert.doesNotMatch(updated, /Watcher 1\.6\.4 is the current public release/);
  assert.match(updated, /paired website-profile avatar API is not yet live/);
  assert.match(updated, /does not retroactively decide unknown games/);
  assert.match(updated, /## v1\.6\.3 public release \(historical\)/);
  assert.equal(rewriteReadme(updated, "1.6.5"), updated);
});

test("does not silently promote any unrecognized or unmatched future release", async () => {
  const { rewriteReadme } = await moduleUnderTest();
  const text = [
    "# aoe2-watcher",
    "",
    "## Watcher 1.6.5 — production integration candidate (October 19, 2026)",
    "",
    "Still under release review.",
    "",
    "## Historical releases",
    "",
    "Old releases.",
  ].join("\n");
  assert.throws(() => rewriteReadme(text, "1.6.6"), /pre-publication release section missing/);
});

test("published 1.6.5 README remains compatible with release docs sync", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { rewriteReadme } = await moduleUnderTest();
  const source = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert.match(source, /## v1\.6\.5 public release/);
  assert.equal(rewriteReadme(source, "1.6.5"), source);
});
