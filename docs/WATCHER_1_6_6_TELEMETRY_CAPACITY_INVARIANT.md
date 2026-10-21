---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-telemetry-capacity-invariant"
title: "Watcher 1.6.6 — Stop the telemetry queue from poisoning itself"
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

# Watcher 1.6.6 — Stop the telemetry queue from poisoning itself

Before this pass the reader enforced a 16 MiB diagnostic-queue ceiling but the writer did not. A near-full queue followed by one more event could persist an unreadable file and indefinitely block later telemetry recovery. Writes now preflight the exact serialized UTF-8 byte size **before creating a temporary file or renaming anything**. Oversize enqueue attempts produce `AOE2_TELEMETRY_QUEUE_TOO_LARGE` while leaving the previous durable queue byte-for-byte unchanged and readable.

`maxEntries`, `maxAgeMs`, and per-flush `limit` are also normalized to positive safe integers; invalid values fall back to the established defaults, and caller-provided queue sizes cap at 4096. Normal/default FIFO, durable-per-enqueue acknowledgments, retention TTL, retryable-stop behavior, and established sender semantics are unchanged.

This is **diagnostics only**. No replay parsing, upload finality, admissions, video, financial features, timers, or network polling are changed. Run the exact pinned version comparison to understand any wall-time penalty rather than assuming a performance gain.

This fixes self-inflicted oversize persistence but does not certify physical CPU, thermal load, idle watts, Windows ACL behavior or release readiness.
