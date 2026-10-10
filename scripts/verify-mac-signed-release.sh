#!/usr/bin/env bash
set -euo pipefail

# Official release only. Unsigned CI must never invoke this attestation.
version="$(node -p "require('./package.json').version")"
app="dist/mac-arm64/AoE2HDBets Watcher.app"
dmg="dist/AoE2HDBets Watcher-${version}-arm64.dmg"
zip="dist/AoE2HDBets Watcher-${version}-arm64-mac.zip"

[[ "$(uname -s)" == "Darwin" ]] || { echo "STOP: Mac release attestation requires macOS" >&2; exit 1; }
[[ -d "$app" && -s "$dmg" && -s "$zip" ]] || { echo "STOP: Missing official macOS release payload" >&2; exit 1; }

for required in CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [[ -n "${!required:-}" ]] || { echo "STOP: missing production Mac credential $required" >&2; exit 1; }
done

npm run verify:mac-updater

codesign --verify --deep --strict --verbose=2 "$app"
signature="$(codesign -dv --verbose=4 "$app" 2>&1)"
grep -Fq 'Authority=Developer ID Application:' <<< "$signature" ||
  { echo "STOP: Mac app is not Developer ID Application signed" >&2; exit 1; }
grep -Fq "TeamIdentifier=$APPLE_TEAM_ID" <<< "$signature" ||
  { echo "STOP: Mac app team ID does not match configured authority" >&2; exit 1; }

assessment="$(spctl --assess --type execute --verbose=4 "$app" 2>&1)" ||
  { echo "STOP: Gatekeeper rejected Mac app" >&2; exit 1; }
grep -Fq 'source=Notarized Developer ID' <<< "$assessment" ||
  { echo "STOP: app lacks Gatekeeper notarization proof" >&2; exit 1; }

xcrun stapler validate "$app"
xcrun stapler validate "$dmg"

# Verify the native updater ZIP carries the correct signed application.
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
ditto -x -k "$zip" "$temp"
unzipped_app="$temp/AoE2HDBets Watcher.app"
[[ -d "$unzipped_app" ]] ||
  { echo "STOP: native ZIP lacks expected app bundle" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$unzipped_app"
unpacked_signature="$(codesign -dv --verbose=4 "$unzipped_app" 2>&1)"
grep -Fq "TeamIdentifier=$APPLE_TEAM_ID" <<< "$unpacked_signature" ||
  { echo "STOP: updater ZIP app signing team mismatch" >&2; exit 1; }

shasum -a 256 "$dmg" "$zip" dist/aoe2hdbets-watcher-direct.zip > dist/SIGNED_MACOS_SHA256.txt
echo "PASS: official Mac release is signed, notarized, and updater-manifest-bound"
