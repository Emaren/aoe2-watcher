---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-queue-local-permissions"
title: "Watcher 1.6.6 — Diagnostic queue local-file hardening"
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

# Watcher 1.6.6 — Diagnostic queue local-file hardening

The long-lived background Watcher writes player/session diagnostic events to a disk queue. Prior atomic temporary files used the operating-system default create mode (often 0644 with umask 022), potentially leaving user metadata readable to other local users.

The telemetry queue now opens temporary files with exclusive-create `wx` and explicit owner-only `0600` permissions, then atomically renames them over the queue. It also rejects a queue path that is a symlink instead of treating it as an ordinary JSON file. If an existing queue is unsafe, the Watcher does **not** overwrite or read the target; diagnostics degrade visibly while the replay engine remains independent.

This does not edit existing queues proactively or add polling. Mode restrictions are POSIX semantics; Windows ACL handling remains an independent installed-client review gate. There is no automatic permission-repair logic or userData-wide chmod.
