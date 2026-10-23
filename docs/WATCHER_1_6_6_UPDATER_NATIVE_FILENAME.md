---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-updater-native-filename"
title: "Watcher 1.6.6 — Exact macOS update artifact naming"
type: "working"
status: "draft"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "git"
authority: "watcher-1.6.6-unreleased-engineering-evidence"
reviewed_at: "2026-10-21"
review_interval_days: 14
sensitivity: "internal"
---

# Watcher 1.6.6 — Exact macOS update artifact naming

During 1.6.6 review, the signed-manifest preflight expected `AoE2HDBets Watcher-V-arm64.zip`. This was incorrect: the existing certified 1.6.5 publisher (`scripts/certify-watcher-v165-release.py`) explicitly requires the native updater ZIP `AoE2HDBets Watcher-V-arm64-mac.zip`, separate from the manual `aoe2hdbets-watcher-direct.zip`.

The signed preflight now pins `AoE2HDBets Watcher-V-{arch}-mac.zip`. Neither the manual ZIP nor the historical wrong basename may authenticate as a native updater archive. Tests bind the exact source-side publisher naming, but real deployed publication for v1.6.6 must still be independently verified before enabling the helper.

This only changes disconnected manifest validation/tests. No game upload, package version, release artifact, Mac app or installer is altered.
