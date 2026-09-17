#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

export function canonicalAssets(version) {
  return [
    `AoE2HDBets.Watcher.Setup.${version}.exe`,
    `AoE2HDBets.Watcher.${version}.exe`,
    `AoE2HDBets.Watcher-${version}-arm64.dmg`,
    "aoe2hdbets-watcher-direct.zip",
    `AoE2HDBets.Watcher-${version}.AppImage`,
  ];
}

export function publicReleaseParagraph(version) {
  return `Watcher ${version} is the current public release. The five-artifact publication gate completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. The immutable \`v${version}\` release and its updater metadata were verified before publication.`;
}

export function rewriteReadme(text, version) {
  const heading = `## v${version} release candidate`;
  const publicHeading = `## v${version} public release`;
  if (text.includes(publicHeading) && text.includes(publicReleaseParagraph(version))) {
    return text;
  }
  const start = text.indexOf(`${heading}\n`);
  if (start < 0) {
    throw new Error(`release candidate section missing for ${version}`);
  }
  const nextHeading = text.indexOf("\n## ", start + heading.length + 1);
  if (nextHeading < 0) {
    throw new Error(`next section boundary missing after ${heading}`);
  }
  const section = text.slice(start, nextHeading);
  const paragraphs = section.split("\n\n");
  if (paragraphs.length < 3) {
    throw new Error(`release candidate section is incomplete for ${version}`);
  }
  paragraphs[0] = publicHeading;
  paragraphs[2] = publicReleaseParagraph(version);
  return text.slice(0, start) + paragraphs.join("\n\n") + "\n" + text.slice(nextHeading);
}

export function releaseInventoryComplete(payload, version) {
  if (!payload || payload.tagName !== `v${version}`) return false;
  const names = new Set((payload.assets || []).map((asset) => asset.name));
  return canonicalAssets(version).every((name) => names.has(name));
}

function githubRelease(version) {
  try {
    const output = execFileSync(
      "gh",
      ["release", "view", `v${version}`, "--repo", "Emaren/aoe2-watcher", "--json", "tagName,assets"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(output);
  } catch {
    return null;
  }
}
function main() {
  const write = process.argv.includes("--write");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const version = String(pkg.version || "").trim();
  if (!version) throw new Error("package version is missing");

  const release = githubRelease(version);
  if (!releaseInventoryComplete(release, version)) {
    console.log(`WATCHER_RELEASE_NOT_COMPLETE version=${version}`);
    return;
  }

  const readmePath = path.join(root, "README.md");
  const before = fs.readFileSync(readmePath, "utf8");
  const after = rewriteReadme(before, version);
  if (after === before) {
    console.log(`WATCHER_RELEASE_DOCS_CURRENT version=${version}`);
    return;
  }
  if (!write) {
    console.error(`WATCHER_RELEASE_DOCS_STALE version=${version}`);
    process.exitCode = 2;
    return;
  }

  fs.writeFileSync(readmePath, after);
  console.log(`WATCHER_RELEASE_DOCS_UPDATED version=${version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
