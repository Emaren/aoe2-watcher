---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-async-telemetry-queue"
title: "Watcher 1.6.6 — Nonblocking Durable Telemetry Persistence"
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

# Watcher 1.6.6 — Nonblocking Durable Telemetry Persistence

Candidate engineering pass on top of the 1.6.6 telemetry ACK and bounded diagnostic-journal integration branch. **Source only, no release, no version bump.**

## Defect and scope

v1.6.5 telemetryQueue.js performed `readFileSync`, `writeFileSync`, `renameSync` and `rmSync` on the Electron main thread for telemetry enqueue, retry and status checks. Corrupt/unreadable JSON was caught and treated as an empty queue, allowing the next enqueue to overwrite useful recoverable evidence.

## Design

- Keep the established serialized queue and replay-agnostic telemetry formats.
- Replace synchronous filesystem access with `fs.promises`, preserving atomic write-to-temp/rename commits and no-progress retry no-rewrite semantics.
- Fail closed on invalid JSON, unexpected queue structure, non-regular file, oversize file or read error. Do **not** overwrite or silently delete recoverable bytes. Missing file is the only clean empty state.
- Preserve FIFO and queue capacity, read independently on every operation (no stale cross-instance in-memory cache).
- Electron main process logs but safely handles queue failures; diagnostic persistence must not interrupt game replay upload or cause unhandled promise rejection.
- Keep offline retry queue and exact `telemetryEventId` unchanged; no financial, video, parser, upload or Watcher finality modifications.

## Remaining limitations / qualification

- This removes **synchronous main-thread disk calls**; reduction in real client stall time and power usage must still be benchmarked on actual hardware.
- A received-but-unacknowledged telemetry write can still generate duplicate events absent persistent server-side idempotency. The companion app server PR #722 only covers retries following database failure and coalescing; it does not by itself guarantee exactly-once storage. Do not claim otherwise.
- Failed writes and corrupt queues are surfaced in local logs. Queue repair is a separately designed, owner-consented operation.
- Zero-loss game replay semantics rely on the unchanged replay uploader and server storage, not the optional diagnostic queue.
- CI must prove malformed-file refusal, clean recovery, async API, bounded queue, FIFO, restart and source regressions.
