---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-mac-bundle-audit"
title: "Watcher 1.6.6 — Read-only extracted Mac bundle preflight"
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

# Watcher 1.6.6 — Read-only extracted Mac bundle preflight

New `macUnsignedUpdateBundleAudit.js` validates **already safely extracted** bundle shape. This is a disconnected inspection component, not an extractor or installer. A real update needs authenticated signed manifest, verified staged ZIP and a separately reviewed extraction routine before the bundle audit may run.

Checks:
- Exact `AoE2HDBets Watcher.app` root, not a symlink.
- Bounded file count, nesting depth and uncompressed file bytes.
- Disallow special files and absolute, dangling or escaping symlinks; retain legitimate framework symlinks pointing within the app bundle.
- Read macOS `Info.plist` via `/usr/bin/plutil`; assert expected bundle ID `com.aoe2hdbets.watcher`, exact target version and safe main executable basename.
- Require executable main binary and target architecture from native `/usr/bin/lipo`.

Tests use injected read-only metadata readers against synthetic, disposable app trees. **Actual macOS bundle validation on an authentic v1.6.6 ZIP is not established by those tests.**

No ZIP extraction or replacement mechanism, signing/notarization bypass, shell invocation, replay processing or financial actions are added. Source evidence cannot certify 100/100 without real Mac qualification.
