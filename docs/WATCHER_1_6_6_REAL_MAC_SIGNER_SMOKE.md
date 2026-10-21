---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-real-mac-signer-smoke"
title: "Watcher 1.6.6 — Real native Mac ZIP ephemeral signing smoke"
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

# Watcher 1.6.6 — Real native Mac ZIP ephemeral signing smoke

The macOS packaging and separately controlled non-Windows release-build workflows now check the **actual** Electron-built updater ZIP twice before promotion: a standard-library ZIP entry/CRC/symlink audit, then an end-to-end Ed25519 publisher/client-verifier test.

For the signing smoke, a new ephemeral key pair is generated **only in runner memory**. The publisher hashes the real ZIP and produces a canonical signed envelope with exact version and GITHUB_SHA. The Watcher's separate verifier authenticates the signature and stream-hashes the real ZIP from disk. Neither the key nor envelope is stored, uploaded, or used to authorize a release.

This creates independent integration evidence that the real archive matches the signing format, including source/version/architecture/bytes. It does **not** claim that a production offline key exists or is pinned, that unsigned-Gatekeeper installation succeeds, or that a Mac update helper exists. This is release-pipeline confidence, not an updater activation.
