---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-3-development"
title: "Watcher 1.6.3 Development"
type: "working"
status: "active"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher","app-prodn"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "git"
authority: "watcher-1.6.3-development-plan"
reviewed_at: "2026-09-30"
review_interval_days: 14
sensitivity: "internal"
---

# Watcher 1.6.3 Development

## Branch contract

Watcher 1.6.3 is a long-running development lane. Improvements accumulate on
feature/watcher-1.6.3-development while the public release remains 1.6.2.

Do not advance package version, updater metadata, website download metadata, or
public release claims merely because this branch exists. Release promotion
still requires the complete five-artifact certification gate.
## Starting point

The branch begins from certified Watcher 1.6.2. Preserve its invariants:

- replay capture and replay truth outrank presentation work;
- passive CPU, memory, wakeup, scan, journal, and telemetry cost stays bounded;
- native video yields to replay upload pressure;
- renderer recovery is bounded and never restarts the replay engine merely to
  repair the dashboard;
- historical import remains disk-backed and bounded;
- support telemetry remains redacted;
- no new personal data is added casually.

1.6.3 should be smaller, quieter, clearer, or more resilient in measurable
ways. A version bump by itself is not progress.

## Evidence-first backlog

The first inputs to 1.6.3 are the field signals 1.6.2 was built to collect:

1. compare idle, ordinary replay, historical-import, and native-stream CPU/RAM
   and wakeup profiles using p50/p95 evidence;
2. inspect very large replay libraries before changing the conservative
   five-minute full-census failsafe;
3. identify repeated payload attempts or retry patterns that can be eliminated
   without weakening durability;
4. use renderer-ready and renderer-recovery evidence to find remaining false
   healthy or unnecessary reload cases;
5. keep system-power claims empirical; powerWatts remains unset without an
   external measurement source.

## First 1.6.2 field finding — resource heartbeat was being overwritten

A production read-only sample on 2026-10-01 covered 671 Watcher 1.6.2
heartbeats from three Watchers / three users. Every heartbeat preserved the
runtime, folder and renderer keys, but 0/671 preserved `resourceProfile`.

The client was building the compact profile correctly at heartbeat creation,
then `buildTelemetryPayload()` appended a second default
`buildRuntimeMetadata(config)` object. Its `resourceProfile: undefined` value
overwrote the real heartbeat profile before transport.

1.6.3 fixes the authority point instead of adding more sampling: telemetry
payload assembly now requests the compact resource profile exactly when
`eventType === "heartbeat"`; the heartbeat scheduler no longer builds a
duplicate runtime-metadata object. Ordinary telemetry remains profile-free.

The same field window does **not** justify speculative renderer or folder work:

- renderer heartbeats: 569 ready, 102 closed, 0 observed failures and 0 reload
  attempts;
- folder census evidence includes a 1,141-entry replay directory with recent
  inspections around 43–114 ms;
- replay events showed 372 upload attempts, 368 successes and no stored
  `upload_failed` events across 10 replay detections. That attempt ratio is
  worth measuring further, but not redesigning until repaired heartbeat
  resource/network evidence establishes the actual cost.

## Television WOLO relationship

Television WOLO does not justify continuous capture by itself. The Watcher may
support richer multi-perspective television only when replay monitoring,
resource budgets, upload priority, and user intent remain protected.

Any 1.6.3 media improvement should prefer:

- on-demand or battle-scoped work over permanent background work;
- existing native-stream contracts over a second transport;
- bounded local buffering;
- replay upload priority over video convenience;
- explicit server acknowledgement before local cleanup.

## Candidate improvements

Candidate work may include better capture lifecycle diagnostics, smaller idle
bookkeeping, improved stream handoff/recovery, clearer support evidence, and
measured reductions discovered from 1.6.2 field profiles.

Each candidate should land as a small tested commit. Features may be removed
from the candidate list when measurement shows they do not pay for their
complexity.
## Release checkpoint

1.6.3 becomes a release candidate only after accumulated work reaches a useful
checkpoint and the branch is clean. At that point:

- freeze scope;
- run lint, contracts, packaging smoke, and platform build gates;
- build Windows installer and portable from the same source as macOS DMG,
  macOS direct ZIP, and Linux AppImage;
- preserve Windows signing and configured macOS policy;
- hash and certify every public artifact and updater manifest;
- verify website download bytes before promoting public metadata.

Until then, 1.6.3 is development only and must not be advertised as the current
Watcher release.
