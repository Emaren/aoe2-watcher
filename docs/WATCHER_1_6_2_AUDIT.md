---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-2-audit"
title: "Watcher 1.6.2 Engineering Audit"
type: "working"
status: "draft"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher","api-prodn"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "git"
authority: "watcher-1.6.2-engineering-plan"
reviewed_at: "2026-09-22"
review_interval_days: 14
sensitivity: "internal"
---

# Watcher 1.6.2 Engineering Audit

## Objective

Watcher 1.6.2 is the "tiny, powerful, gentle" pass. It must preserve replay truth,
fallbacks and diagnostics while making ordinary live watching difficult for a user
to notice: low CPU, stable memory, little disk churn, bounded network activity,
safe self-recovery, and upgrades that do not interrupt a match.

1.6.1 remains public until this branch earns a complete Windows, macOS and Linux
release gate. Nothing in this document authorizes publication or production rollout.

## What is already strong

- Native `fs.watch` is the primary replay detector. Recovery scanning is a
  one-minute failsafe, not the main engine.
- Replay-folder freshness probing is five-minute safety work, not constant polling.
- Live replay, historical import and optional video streaming are separate workload
  rails; replay delivery has network priority over video.
- Historical imports are serial, oldest-first and disk-backed one replay at a time.
  Stable historical parser failures advance instead of entering live-growth loops.
- Telemetry queues, runtime journals and UI logs are bounded.
- Update installation already waits for active replay, import, upload or native
  streaming work to clear.
- Windows has installer and portable fallbacks; macOS has DMG and direct ZIP;
  Linux has AppImage.
- The Watcher reports observations and replay provenance; it does not gain result,
  betting, settlement or Wolo authority.

## Audit findings

### P1 — resource cost was not directly visible

Before this branch, support telemetry could prove what the Watcher was doing but
not how expensive the Watcher itself was. CPU, RAM, processor wakeups and
Watcher-attributable network rate were absent from the user-facing diagnostics.

**1.6.2 status:** first tranche implemented. The Watcher samples the Electron
process tree every 15 seconds while replay/import/stream work is active, backs off
to 60 seconds whenever the Watcher is otherwise idle (even if the dashboard remains
open), keeps a small rolling window, records
session peaks, and publishes only the compact resource summary through the existing
heartbeat.

### P1 — power must be measured without pretending

Electron does not expose portable per-process watts. CPU percentage and idle
processor wakeups are useful power evidence, but they are not watts.

**Rule:** the product may show a power signal based on measured CPU/wakeups, but
must keep `powerWatts = null` until a real platform-specific or controlled
system-level benchmark produces defensible watt data.

The release benchmark should compare the same machine in at least these states:

- AoE2 HD alone
- AoE2 HD + Watcher armed/idle
- AoE2 HD + live replay watching
- historical import
- watcher-native video streaming

For ordinary replay watching, the target is background-scale overhead. Streaming
is explicitly a separate, heavier workload and must never be used to characterize
normal Watcher cost.

### P1 — large replay folders can make status inspection expensive

A folder-status census currently enumerates the directory and stats supported replay
files to identify the newest replay. That is useful truth, but a very large archive
can turn an otherwise idle heartbeat into unnecessary filesystem work.

**1.6.2 status:** passive status caching is extended from one minute to five minutes,
and every inspection now reports `entriesScanned` plus
`inspectionDurationMs`. Optimize further only after real large-library evidence
shows the cost is material.

Likely next step, if measurements justify it: maintain the newest-replay/status
cache from native filesystem events and reserve full census work for startup,
manual validation and infrequent recovery.

### P1 — macOS update friction is still too manual

Current macOS builds intentionally use download-and-replace. That produces the DMG
and Finder sequence seen in the field: download, open, quit the running Watcher,
replace Applications, reopen.

**1.6.2 target:** one deliberate in-app update action, deferred until the Watcher is
idle, cryptographically bound to certified release bytes, then replace/relaunch
without browser/Finder choreography. Apple signing/notarization and Gatekeeper
behavior are part of the design constraint; convenience must not weaken release
provenance.

### P1 — runtime diagnostics should not create avoidable disk churn

The runtime event journal previously performed a synchronous append for every local
runtime event. That preserved diagnostics, but busy replay activity could turn the
journal itself into needless filesystem churn.

**1.6.2 status:** runtime events now buffer in memory and flush asynchronously after
up to two seconds or 64 KiB. The existing bounded journal rotation remains in
place. Graceful quit now prevents process exit until the already-queued async
journal chain has drained, then stops the watcher, records its final stop telemetry,
and performs one bounded synchronous final-buffer flush. The updater path drains
that same journal before calling Electron's `quitAndInstall` and marks the generic
quit drain complete first, so diagnostic durability cannot accidentally intercept
the installer shutdown sequence. This preserves the IO reduction without making the
last diagnostic events race application shutdown.

### P1 — durable telemetry retries should be durable, not chatty

The telemetry retry queue is needed when the event endpoint is temporarily
unavailable, but a healthy empty queue should not create a minute-by-minute disk
write just because the heartbeat asks whether anything is pending. Likewise, a
retryable failure that made zero queue progress does not need to atomically rewrite
the same durable JSON bytes.

**1.6.2 status:** an empty flush leaves no queue file behind; draining the final
entry removes the file instead of persisting `[]`; a stale-only legacy queue file
is retired on the next flush; and a retryable no-progress flush keeps the existing
durable file untouched. Enqueue still seals retryable telemetry failures
immediately, so crash durability is not traded for lower IO.

### P1 — historical state must stay bounded as archives grow

The historical scanner previously called the state-creation helper for every
supported replay before deciding whether the replay needed work. A large archive
could therefore grow the in-memory replay-state map simply by being scanned. Each
successful historical final also rewrote the complete persisted settlement-state
file immediately.

**1.6.2 status:** scan-only candidates now use lookup without allocation. A state
entry is created only after a replay is stable and actually needs work; transient
failed import state is released after the item; settled entries are pruned to the
existing 5,000-entry durability limit; and historical imports persist the bounded
settlement snapshot once after the batch rather than once per successful replay.
The in-memory map now applies the same 90-day settlement age contract as the
persisted snapshot, while never pruning a replay that is actively monitoring or
importing. Server-side duplicate handling remains the safety net if the app exits
mid-import.

### P2 — repeated whole-replay live uploads are a measurable cost center

Live parsing currently needs complete immutable replay snapshots, so a growing match
may send the whole replay again at bounded intervals. That favors parser simplicity
and truth over clever deltas.

Do not redesign this blindly. The new resource/network profile should first measure
real replay sizes, retry rates and transfer duty cycle. If it is materially costly,
evaluate adaptive cadence or server-side incremental parsing without weakening the
immutable-snapshot contract.

### P2 — Electron packaging is larger than the logical Watcher

The release artifacts are roughly in the 100–130 MB class because Electron carries
its runtime. Installer size is not the same thing as runtime CPU/RAM/power cost.

A future native shell is only justified if measured runtime or distribution cost
outweighs the maintenance and cross-platform reliability of the current single
Electron core. "Smaller executable" is not allowed to become a vanity metric.

## 1.6.2 resource profile

The user-facing Diagnostics panel is intentionally limited to the most useful
numbers:

1. **CPU** — current and rolling average for the complete Electron process tree.
2. **Memory** — current working set and session peak.
3. **Processor wakeups** — a useful power-efficiency signal where Electron/Chromium
   reports it.
4. **Watcher network** — current and rolling Watcher-attributable replay/stream
   payload rate.
5. **Power signal** — Gentle / Light / Active / High / Streaming, derived from
   measured CPU/wakeups and explicit workload state, never represented as watts.

Support snapshots and heartbeat metadata carry the same compact values. No absolute
replay path, key, replay contents or new personal data is added by this feature.

## Next audit passes before release

- Run an actual idle/live/import/stream resource benchmark on Windows and macOS;
  capture p50/p95 CPU, RAM peak, wakeups, network and defensible system-power delta.
- Exercise huge replay libraries and decide whether event-maintained folder metadata
  can replace most full status censuses.
- Build the macOS idle-safe verified self-update path or document the exact signing
  blocker if Apple trust requirements prevent it.
- Measure app startup/background process count and remove only work proven redundant.
- Re-audit timers, retries, telemetry queue limits, runtime-journal rotation and
  sleep/wake recovery after the resource instrumentation itself has soaked.
- Re-run Windows installer/portable, macOS DMG/ZIP and Linux AppImage packaging,
  signing/notarization policy, hashes and updater manifests before changing public
  version metadata.

## Release boundary

Do not call this 1.6.2 publicly until:

- all Watcher contracts and package smoke tests are green;
- measured normal replay-watching resource behavior is acceptable;
- no resource regression appears during historical import;
- update behavior is safe while a replay/import/stream is active;
- all five platform artifacts are built and cryptographically certified; and
- public app metadata is promoted only after the production Watcher vault contains
  those exact certified bytes.
