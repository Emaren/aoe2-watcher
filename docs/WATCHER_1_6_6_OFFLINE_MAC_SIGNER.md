---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-offline-mac-signer"
title: "Watcher 1.6.6 — Offline Mac release signing (DRAFT)"
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

# Watcher 1.6.6 — Offline Mac release signing (DRAFT)

**This tool creates no production signing key, release or deployment.** It is an isolated offline publisher. Public 1.6.5 and replay upload behavior are untouched.

The publisher consumes the exact independently certified native Mac updater ZIP (AoE2HDBets Watcher-V-arm64-mac.zip) and immutable 40-character build source SHA. It computes the actual bytes and SHA-256 through a bounded, no-follow stream, then creates the canonical stable-version, source, platform and archive manifest required by macUnsignedUpdateManifest.js. It signs with Ed25519 and writes a fresh owner-only envelope into a private folder.

The private signing key **must** be created and retained outside GitHub, CI, the AoE2WAR site, Watcher userData, and connected machines. An independently approved SPKI SHA-256 fingerprint is required to prevent accidentally signing with a wrong key. Tests use ephemeral local keys, not a deployable secret.

Offline invocation requires seven explicit arguments: native ZIP absolute path, stable version, architecture, exact certified source SHA, private PEM file path (owner-only), approved public SPKI SHA-256, and private output path named watcher-mac-release-V-arch.json. It refuses overwriting signed records. Only public release digests are printed.

**Not yet fulfilled:** the real offline key ceremony, review/pinning of the public key in installed Watcher code, source/artifact attestation within the protected release controller, review of safe archive extraction, Mac user-scoped replacement and rollback, Gatekeeper consent behavior, and physical installed-client canary. No one-click updater is activated.
