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
  const actual = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "README.md"),
    "utf8",
  );
  const once = rewriteReadme(actual, "1.5.12");
  const twice = rewriteReadme(once, "1.5.12");
  assert.equal(twice, once);
});
