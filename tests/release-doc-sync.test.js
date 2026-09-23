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
test("an already-public release stays current even with richer release prose", async () => {
  const { rewriteReadme } = await moduleUnderTest();
  const source = [
    "# aoe2-watcher",
    "",
    "## v1.6.1 public release",
    "",
    "Watcher 1.6.1 is public with richer provenance and hotfix detail.",
    "",
    "## v1.6.0 public release",
    "",
    "Previous release.",
    "",
  ].join("\n");

  assert.equal(rewriteReadme(source, "1.6.1"), source);
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
