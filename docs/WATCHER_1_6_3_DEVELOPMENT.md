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

## Fourth field finding — background Mac updates were easy to miss

The local packaged Mac Watcher was still 1.6.1 while the public
`latest-mac.yml` feed advertised 1.6.2. Production telemetry proved the
updater itself was healthy: the same Watcher detected 1.6.2 twice on
2026-09-30 and entered `manual_required` with
`mac_manual_unsigned`, with no updater error.

That exposed a presentation gap rather than an update-check failure. macOS
manual replacement is intentional unless signed auto-update is explicitly
enabled, but the tray menu previously keyed only on
`updateState.downloaded`. A manual Mac update is never downloaded, so a
background Watcher that already knew 1.6.2 was available could continue to
show only `Check for Updates`.

1.6.3 makes manual-required update state visible without changing signing or
installation policy:

- the tray label becomes `Download Watcher <version>`;
- the tray tooltip states that the specific update is available;
- the tray action opens the canonical manual update URL directly;
- the artifact URL discovered with the update is captured in
  `manualDownloadUrl` and remains authoritative across renderer, tray, and
  manual-required install responses; mutable release-state URLs are fallback
  only when no captured artifact URL exists;
- downloaded auto-update platforms keep their existing install action;
- ordinary/current state still shows `Check for Updates`.

## Fifth field finding — update discovery was launch-bound

A live-version census on 2026-10-01 found two Watchers with heartbeats in the
preceding ten minutes: one on 1.5.10 and one on 1.6.1, with no active 1.6.2
client in that window. The 1.6.1 client had already discovered 1.6.2 as a
manual update. The older 1.5.10 client had previously downloaded 1.6.1 and was
still reporting `pending_install`; current 1.6.x update-blocking policy already
addresses the idle-watcher portion of that older behavior.

Source review found no periodic release discovery in current code: packaged
clients checked at startup, or when a person explicitly requested a check.
A long-lived background process could therefore remain unaware of a release
published after it started.

1.6.3 adds a bounded background recheck contract:

- startup still performs the immediate existing update check;
- a current/idle client rechecks every six hours;
- the interval cannot be configured below one hour;
- no network recheck occurs while an update is already checking, available,
  downloading, manually required, downloaded, pending installation or
  installing;
- updater polling is stopped during update installation and graceful quit.

This is four lightweight release checks per day at most for a continuously
running current client, and zero periodic release traffic once an update is
already known.

## Sixth field finding — archived final bytes are not a settled result

The October 2 championship field run exposed a terminal-state semantic bug in
the Watcher. HD replay bytes could become quiet and stable enough to be stored
as a final replay while the parser still had no trustworthy winner evidence.
The upload response correctly represented that distinction:

- `finalStored=true`: the final candidate bytes were durably archived;
- `finalAccepted/resultReady=true`: the server accepted those bytes as
  competitive result authority.

Watcher 1.6.2 collapsed those states after the bounded settle window:
`hasSettledReplayFingerprint()` accepted either `finalAccepted` or
`finalStored`. A replay routed to result review could therefore be described
locally and in telemetry as fully settled even though its winner was still
unknown.

1.6.3 preserves the distinction end to end:

- `hasSettledReplayFingerprint()` now requires `finalAccepted`;
- archived-but-unresolved bytes enter the separate
  `hasReviewRoutedReplayFingerprint()` state;
- after the same bounded byte-observation window, trusted results emit
  `final-settle-observation-complete`;
- archived unresolved results emit
  `final-result-review-observation-complete` with
  `resultReady=false` and `reviewRouted=true`;
- the Watcher still exits active polling after that bounded window, so the fix
  does not create a permanent CPU or filesystem loop;
- the existing recovery watchdog still reopens monitoring when a stored
  replay later changes on disk, including across Watcher restart.

This change does not infer a winner and does not weaken server result
authority. It only prevents durable replay storage from being mislabeled as a
settled competitive result. Server-side accepted adjudication and
rating-delta authority remain the safe fallback when HD terminal bytes omit
winner proof.

Validation on the 1.6.3 development branch:

- focused terminal/restart suite: 23/23;
- full Watcher suite: 112/112;
- lint: clean;
- diff whitespace check: clean.

## Measured no-change conclusions

The final 1.6.3 hotspot pass deliberately leaves several subsystems unchanged
because measured cost is already tiny relative to their reliability value.

### Idle Electron footprint

An eight-sample local measurement of the packaged 1.6.1 Mac Watcher while idle
showed:

- total process-tree CPU p50 0.00%, p95/max 0.10%;
- total resident memory about 100.2 MiB across three Electron processes;
- main process about 81.7 MiB;
- GPU helper about 11.6 MiB;
- network service about 7.7 MiB.

Idle CPU is already effectively invisible. Disabling hardware acceleration to
chase roughly 12 MiB of GPU-helper memory is not justified because it would
degrade the dashboard/video path for a very small fixed-memory saving. The
remaining memory is primarily Electron runtime floor, not evidence of a
Watcher-logic leak.

### Recovery scan

The live recovery fallback was benchmarked against the real local SaveGame
folder:

- 1,260 directory entries;
- 1,042 supported replay files;
- eight complete `readdir + stat` passes;
- total pass time about 13.6–17.2 ms.

At one pass per minute this is roughly 0.025% wall-clock duty. The 60-second
fallback is retained because it protects against missed native/CrossOver
filesystem notifications at negligible measured cost.

### Telemetry and other timers

The 1.6.2 field window contained 671 heartbeats totaling only about 0.90 MiB of
metadata, while replay payload attempts totaled hundreds of MiB. Telemetry is
therefore not a meaningful bandwidth target.

Other recurring work is already bounded:

- resource profiling: 60 seconds idle, 15 seconds only during active work;
- telemetry heartbeat: 60 seconds;
- monitor watchdog: 60 seconds, with fuller folder freshness work every five
  minutes;
- update recheck: six hours;
- renderer watchdogs and stream heartbeats exist only while their UI/stream
  workload is active;
- runtime journal flushing is event-driven and buffered.

No further cadence, GPU, telemetry or recovery-loop changes should be made
without repaired 1.6.3 resource heartbeat evidence showing a real regression
or measurable hotspot.

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
