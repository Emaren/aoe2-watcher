---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-mac-transaction-journal"
title: "Watcher 1.6.6 — Disconnected durable Mac update transaction journal"
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

# Watcher 1.6.6 — Disconnected durable Mac update transaction journal

Source-only helper primitive. It **does not install an app, quit a process, accept a remote command, or authorize releases**.

Within an already created, owner-private staging directory, it persists immutable transition records using exclusive 0600 temporary files, fsync, atomic rename, and directory fsync. Records are checksummed solely for accidental corruption detection. They are **not signed installation/health proofs**: any actor with write access to the staging directory can alter both record and checksum.

All writes require exclusive per-attempt lock and caller-supplied prior sequence; conflicting calls cannot both advance the same version. A stale lock is **not** silently recovered after crash. The future helper must independently investigate actual process state, backup identity and stage directory before supervised recovery.

A crash after old-app backup, swap or relaunch always yields manual `MANUAL_VERIFY_BACKUP_AND_RESTORE` recovery instructions from the state machine. No automatic rollback action exists here. A future installer may not infer a healthy installation from this journal.

The journal is intentionally kept out of `main.js`, game upload logic, financial keys and any background work. Real Mac filesystem/permission/power-loss canaries remain mandatory.
