---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-transfer-accounting"
title: "Watcher 1.6.6 — Honest Resource Transfer Accounting"
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

# Watcher 1.6.6 — Honest Resource Transfer Accounting

The 1.6.5 profiler counted replay payload bytes at `upload-start` and video bytes before the `axios.post` network operation. A failed, blocked or preempted upload could therefore inflate the displayed network Mbps even though the server never acknowledged the payload.

1.6.6 counts a replay payload only at `upload-success` and a video chunk only after the HTTP request resolves successfully. The existing bounded resource profiler continues to aggregate the same information with no extra timers, file access or per-byte instrumentation.

New `networkMeasurement: "http-acknowledged-payload-estimate"` discloses the measurement scope. A successful HTTP response is not proof of parsing, settlement or finality; the replay engine's existing fields remain authoritative for those.

**Limitation:** Mbps here represents acknowledged logical payloads divided by a sampling interval. This is neither actual NIC throughput nor precise transmission timing and does not count packets, TLS overhead or failed attempts. Do not present it as measured network bandwidth. Physical 1.6.5-versus-1.6.6 CPU/memory/network cohorts are still required before a 100-point score.

No change to replay upload, retry, packet sending, parse admission, capture, financial authority or UI layout.

## Bounded resource history (source-only 1.6.6 candidate)

`createResourceProfiler({ windowSamples })` now clamps the rolling sample
history to **2–64** entries (default **8**). A metric sample includes the
current Electron process topology and must not accumulate indefinitely when
a malformed or extreme diagnostic configuration requests an enormous window.
The existing five workload-cohort aggregates retain their lifetime sample
counts independently of the rolling window; this does not add polling,
wakeup timers, network operations, or telemetry fields.

The adversarial source regression feeds 256 samples per configured window,
covering defaults, fractions, negative values, NaN, Infinity, and very large
finite numbers. This is a **bounded-memory code invariant**, not evidence
that an installed Watcher uses less RAM, CPU, power, or battery. Physical
device measurements and installed-client release qualification remain HOLD.
