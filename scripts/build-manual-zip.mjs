#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const watcherDir = path.resolve(scriptDir, "..");
const distDir = path.join(watcherDir, "dist");
const packageJsonPath = path.join(watcherDir, "package.json");
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
const productName = packageJson.productName || "AoE2HDBets Watcher";
const productSlug = productName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const appBundleName = `${productName}.app`;
const appBundlePath = path.join(distDir, "mac-arm64", appBundleName);
const payloadDir = path.join(distDir, `${productName} Direct`);
const outputZipPath = path.join(distDir, `${productSlug}-direct.zip`);
const readmePath = path.join(payloadDir, "README.txt");

const readmeBody = `${productName} ${packageJson.version} direct ZIP

This ZIP contains the same ${productName} app bundle as the DMG.
Same watcher. Same uploads. Same replay flow.

Recommended:
1. Move ${appBundleName} into /Applications.
2. Open the app.
3. Paste your watcher key from https://aoe2hdbets.com/profile once.
4. Leave the watcher open while you play.

If macOS blocks the unsigned app, run:
xattr -dr com.apple.quarantine "/Applications/${appBundleName}"
open "/Applications/${appBundleName}"

If you keep the app somewhere else, replace the /Applications path above with the path on your Mac.
`;

async function main() {
  try {
    await fs.access(appBundlePath);
  } catch {
    throw new Error(
      `App bundle not found at ${appBundlePath}. Run "npm run dist:mac" before building the direct ZIP.`
    );
  }

  await fs.rm(payloadDir, { recursive: true, force: true });
  await fs.mkdir(payloadDir, { recursive: true });

  execFileSync("ditto", [appBundlePath, path.join(payloadDir, appBundleName)], {
    stdio: "inherit",
  });
  await fs.writeFile(readmePath, readmeBody, "utf8");

  await fs.rm(outputZipPath, { force: true });
  execFileSync(
    "ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", payloadDir, outputZipPath],
    {
      stdio: "inherit",
    }
  );

  process.stdout.write(`Built direct ZIP release -> ${outputZipPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
