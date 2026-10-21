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

## Safe background timer overrides

Resource profiling, the monitor watchdog, replay-folder freshness checks,
folder-status caching, update rechecks and diagnostic journal flushes now
use a single startup-only bounded interval policy. Malformed, non-finite
or non-positive environment overrides fall back to established defaults;
subminimum values are clamped to a safe floor and huge values to Node's
finite supported timeout range. The normal timer defaults and user
behavior remain unchanged. No new polling loops or timers were added.

The monitor reattach limit is also a bounded safe integer; hostile
environment values cannot turn the retry cap into Infinity. Pure-source
regressions cover NaN, Infinity, whitespace, negatives and extremely
large overrides and require Electron main to route these intervals through
the bounded helper. This prevents avoidable tight-loop battery/CPU drains;
it does not establish installed-device wakeup or power measurements.

## Diagnostic journal resource ceilings

The runtime journal has three separate byte budgets: rotating on-disk
history (default 5 MiB, maximum 32 MiB), pending asynchronous write
backlog (default 1 MiB, maximum 8 MiB), and the main-process aggregation
buffer (default 64 KiB, maximum 1 MiB). Invalid, non-finite, blank, zero
and negative environment values now select the established defaults;
extreme valid overrides are clamped to their explicit upper bounds.

This is a resource-limit guarantee for optional diagnostics, not a replay
payload or video modification. It creates no new sampling timers or
network requests. Regression tests require the live Electron main
configuration to call the finite bounded-limit helper and verify all
three maximum budgets even with hostile environment settings.
Physical installed memory, energy and disk-wear canaries are still HOLD.
