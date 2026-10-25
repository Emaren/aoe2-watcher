#!/usr/bin/env bash
# CI-only: verify real, bundled macOS resource sealing without treating ad-hoc
# signing as Developer ID/notarization. Never modifies a bundle or installed app.
set -euo pipefail
if [[ $# -ne 1 || "$(uname -s)" != "Darwin" ]]; then
  echo "STOP: expected one macOS .app bundle path on a macOS runner" >&2
  exit 2
fi
app="$1"
if [[ ! -d "$app" || -L "$app" || "$app" != *.app ]]; then
  echo "STOP: bundle missing or unsafe root" >&2
  exit 2
fi
seal="$app/Contents/_CodeSignature/CodeResources"
if [[ ! -f "$seal" || -L "$seal" || ! -s "$seal" ]]; then
  echo "STOP: macOS resource seal missing or empty" >&2
  exit 3
fi
plutil -lint "$seal" >/dev/null || { echo "STOP: invalid resource seal plist" >&2; exit 3; }
if ! codesign --verify --deep --strict --verbose=2 "$app"; then
  echo "STOP: extracted/built macOS bundle fails deep strict signature verification" >&2
  exit 4
fi
details="$(codesign -d --verbose=4 "$app" 2>&1)" || {
  echo "STOP: cannot read bundle signing identity" >&2; exit 4;
}
if ! grep -Fqx "Signature=adhoc" <<< "$details" ||
   ! grep -Fqx "TeamIdentifier=not set" <<< "$details" ||
   ! grep -Eq '^Sealed Resources version=2 ' <<< "$details"; then
  echo "STOP: unsigned channel requires a full ad-hoc resource seal, no Apple Team identity" >&2
  exit 5
fi
echo "MAC_ADHOC_RESOURCE_SEAL_PASS"
echo "APPLE_DEVELOPER_ID_OR_NOTARIZATION=NOT_CLAIMED"
