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
  `upload_failed` events across 10 replay detections;
- size/fingerprint follow-up showed that 362/372 attempts were the first
  attempt at a newly observed replay size; only 10 attempts repeated an
  already-seen size, with at most three attempts at one size;
- one long battle produced 159 attempts across 153 distinct sizes over about
  42.5 minutes. A deeper session-level trace showed two interleaved parse
  iteration trains in the same Watcher process, so this outlier was not normal
  30-second rolling cadence.

## Second 1.6.2 field finding — duplicate live monitor ownership

Across nine replay files, 1.6.2 attempted about 383.0 MiB of replay payload.
Eight files showed median upload gaps around 31.6–34.3 seconds, matching the
30-second live cooldown plus processing time.

The outlier replay reached only about 2.2 MiB but attempted 225.6 MiB over
42.5 minutes: roughly 101.7 final-file equivalents. It came from one Watcher ID
and one app session, with two concurrent parse-iteration trains advancing
1..78 and 1..77.

The race was inside `monitorReplayFile()`: `entry.monitoring` was checked,
then `resolveFinalReplayShortCircuit()` was awaited, and only afterward was
`entry.monitoring` set. Near-simultaneous detections could both pass the guard
before either caller owned the replay.

1.6.3 now claims replay-monitor ownership synchronously before the first async
final-state inspection and always releases that claim in `finally`. The
existing 30-second live cadence, immutable snapshot contract, retries, final
quiet-period logic and settlement rules are unchanged.

## Third 1.6.2 field finding — established live cadence is over-sampled

After excluding the duplicate-monitor outlier, eight normal 1.6.2 replays
produced 211 logical live/final upload iterations. Their final-ish bytes totaled
about 7.7 MiB, while the logical rolling snapshots totaled about 155.6 MiB:
roughly 20.5 final-file equivalents.

The production live-session projection keeps non-final replay truth fresh for
12 minutes, while final replay readiness is driven independently by replay-byte
quiet/stability checks. The 30-second cadence therefore has substantial safety
margin after the first live identity observations.

A replay-trace simulation preserved the first three live snapshots at the
existing cadence, then sampled the established replay every 60 seconds while
still preserving final uploads. Across the eight normal games this reduced
logical snapshot payload from about 155.6 MiB to 85.7 MiB, a projected 44.9%
reduction, without weakening the first three live observations or the final
quiet/stability path.

1.6.3 adopts that bounded policy:

- pre-first-success retry behavior remains unchanged;
- the first three successful live snapshots retain the 30-second cadence;
- established live replay snapshots back off to 60 seconds;
- an explicitly longer configured live cooldown is never shortened;
- final candidate timing, immutable snapshot integrity and retry semantics are
  unchanged.

Repaired 1.6.3 resource heartbeats remain the authority for deciding whether
any further cadence change is justified.

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
