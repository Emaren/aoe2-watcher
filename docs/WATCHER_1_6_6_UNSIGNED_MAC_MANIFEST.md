---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-unsigned-mac-manifest"
title: "Watcher 1.6.6 — Unsigned macOS Offline Release-Manifest Verifier (preflight)"
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

# Watcher 1.6.6 — Unsigned macOS Offline Release-Manifest Verifier (preflight)

**Source-only, disconnected security primitive. NOT a working updater.**

Adds `macUnsignedUpdateManifest.js`: bounded, strictly parsed, Ed25519-verified payload envelope; strictly newer stable versions; SHA-256 plus exact asset size and architecture; pinned first-party HTTPS artifact origin; a byte-level archive checksum verifier.

The entire release metadata payload is authenticated with an offline private key. Parsing requires canonical JSON and excludes duplicate-field ambiguity. Unauthenticated metadata is never used to select a URL or version.

**Critical missing release dependency:** the offline release public key must be reviewed and pinned in the *compiled Watcher source* by the separate release ceremony. The installed client must never trust a key provided by the website, release response, environment variable or self-signed metadata. Unit tests use ephemeral keys only. No production release key has been generated, accepted, installed or claimed by this pass.

The module is intentionally **not connected** to the current signed/native `electron-updater` flow, and will not enable unsigned Mac auto-updates by itself. Safe bounded streaming downloads, redirect refusal, ZIP containment / symlink proof, user-scoped helper, graceful process-exit fencing, atomic rollback and physical Gatekeeper/installed-app canaries remain required by [issue #49](https://github.com/Emaren/aoe2-watcher/issues/49).

Existing Windows NSIS and Linux AppImage paths, video, replay uploading, parsing, and all financial custody boundaries are unaffected. Release version stays v1.6.5 until independently certified 1.6.6.
