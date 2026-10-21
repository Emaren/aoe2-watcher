---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-mac-swap-rehearsal"
title: "Watcher 1.6.6 — Offline app-swap / rollback filesystem rehearsal"
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

# Watcher 1.6.6 — Offline app-swap / rollback filesystem rehearsal

**NOT an installed Mac updater.** This source-only module is deliberately restricted to a fresh, private, direct child of the current OS temporary directory whose name starts `watcher-swap-rehearsal-`. It cannot operate on `/Applications`, `~/Applications`, or the running Watcher app; never import it from the shipped Electron main process.

The rehearsal performs **real filesystem renames** between disposable `installed`, `staged` and `backup` subdirectories. It rejects symlinked/foreign-owned/multi-device locations, a pre-existing backup, missing external process-exit witness, and stale locks. After backing up the old app, it swaps in the candidate and requires a *test witness* for post-swap health before declaring success. Backup is retained even after successful rehearsal. On injected failures before or after backup/swap, it restores the known-good old app and retains the bad candidate for diagnostics rather than deleting it.

This is structural rollback evidence only. The witnesses in synthetic tests are not authentication, real app health, or proof that Gatekeeper allows an unsigned installed app. A real user-scoped installer needs **independently pinned signed release proof, trusted extraction, live process exit evidence, exact allowed install location, crash-recovery journal, verified launch, owner consent and actual Mac canaries**. Root-owned `/Applications` cannot be assumed to be safely writable by a nonprivileged user process.

Never add this rehearsal module to `package.json build.files`. Do not permit a filesystem root parameter from network input, do not run `sudo`, do not clear quarantine, do not label the source-only tests as real one-click P0 completion. The frozen 1.6.5 replay ingress remains byte-identical.
