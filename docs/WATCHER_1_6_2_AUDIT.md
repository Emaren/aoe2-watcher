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
reviewed_at: "2026-09-29"
review_interval_days: 14
sensitivity: "internal"
---

# Watcher 1.6.2 Engineering Audit

## Objective

Watcher 1.6.2 is the "tiny, powerful, gentle" pass. It must preserve replay truth,
fallbacks and diagnostics while making ordinary live watching difficult for a user
to notice: low CPU, stable memory, little disk churn, bounded network activity,
safe self-recovery, and upgrades that do not interrupt a match.

1.6.1 remains the public release until the owner publication handoff completes.
1.6.2 has earned the complete source, package, platform-signing and cryptographic
certification gate. Its resource instrumentation is also the vehicle for collecting
real-machine field evidence after publication; this document does not turn proxy
signals into invented watt claims.

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

**1.6.2 status:** implemented. The Watcher samples the Electron process tree every
15 seconds while replay/import/upload/stream work is active, backs off to 60 seconds
whenever the Watcher is otherwise idle (even if the dashboard remains open), keeps a
small rolling window, and records session peaks. The remote profile is a compact
support subset attached only to the existing heartbeat; ordinary replay lifecycle
events do not inherit the resource block.

### P1 — dashboard bootstrap health was not independently observable

A Sep. 29 Windows 1.6.1 field report showed a repeatable split-brain support state:
the Watcher engine remained authenticated, heartbeating, monitor-attached, and bound
to a valid active HD folder while the desktop window stayed on the static
`Loading watcher…` placeholder after a full process-tree restart.

The exact local JavaScript exception cannot be recovered retroactively because 1.6.1
did not report renderer startup truth. Its main process marked `rendererReady=true`
on Electron `did-finish-load`, which proves HTML finished loading but does not prove
that preload, renderer JavaScript, initial IPC, or first meaningful render completed.

**1.6.2 status:** implemented and contract-tested.

- The renderer sends an explicit readiness handshake only after config/app state has
  loaded and the first meaningful UI render has completed.
- Main tracks closed / booting / recovering / ready / failed state independently of
  replay-engine health.
- A bounded 12-second boot watchdog records a sanitized `watcher_error` and updates
  the local dashboard to a human-readable startup issue instead of leaving an
  indefinite loading placeholder.
- Main observes preload errors, main-frame load failures, renderer-process loss and
  unresponsive state. Global renderer exceptions/rejections report through the same
  bounded support rail when the preload bridge is available.
- At most one cache-bypassing dashboard reload is attempted. Replay monitoring is not
  restarted. A renderer-process crash during native streaming clears the stale local
  stream-active flag first because MediaRecorder lived in the dead renderer.
- Heartbeats expose renderer status, readiness, bootstrap time, last failure reason,
  failure count and recovery-attempt count without transmitting API keys or full local
  paths.
- The readiness race is covered: an early successful IPC handshake is never demoted
  later merely because Electron subsequently emits `did-finish-load`.

This does not claim the unknown 1.6.1 field exception itself was identified. It closes
the support blind spot so the same class of failure becomes self-describing and, when
safe, self-recovering.

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
4. **Payload attempt rate** — current and rolling replay/stream payload bytes
   offered to transport. This intentionally includes retries/fallback attempts and
   is not presented as exact successful wire bytes.
5. **Power signal** — Gentle / Light / Active / High / Streaming, derived from
   measured CPU/wakeups and explicit workload state, never represented as watts.

Support snapshots and heartbeat metadata carry the same compact values. No absolute
replay path, key, replay contents or new personal data is added by this feature.

## Certified release evidence

The Sep. 29/30 UTC certification chain completed successfully:

- runtime source: `1d1e9b3ca9f95a89cf47ab582219e4c85b725603`;
- build source shared by all five platform candidates:
  `b1e3b1353aa48840bdaa7d8afc353e1afc5bf22d`;
- Watcher CI on the build source: run `36649412606`, success;
- Windows installer + portable build and Azure Artifact Signing:
  run `36649412730`, success;
- macOS DMG/direct ZIP + Linux AppImage build:
  run `36649412594`, success;
- immutable certification/publication-bundle workflow:
  run `36649765669`, success;
- certified bundle artifact `certified-watcher-release-1.6.2`,
  outer digest
  `39123c7f47adcde308be83ee904f9c5ca4319c793b5911a05b3d7600c82449f4`.

Certified principal artifacts:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Windows installer | 108043264 | `80c04168949c791cfdc0c67432c2ac4868459219923d8b7c96efc40f24d8d0c3` |
| Windows portable | 107780592 | `4b7d0709dae6e9a80ea400bbb88a87a3880b0d5bf99dac11bcdb5e8b6ff129f7` |
| macOS DMG | 129148488 | `89860bc8d3a95283cb49d9d86f8a8b8b07e0423b3c7f53ddd5ddd003b1c8df95` |
| macOS direct ZIP | 127433063 | `d2bfb053cf78418fa90d1dca20d223f8488c3baa82071d5db515dbbaceb38a78` |
| Linux AppImage | 134026163 | `a73367344321e0e9399192dd47e588adab68770aa1632636ab4f3f3e1743237a` |

Secondary certified evidence includes DMG blockmap
`c14e65579e54b2417766c5ab816798fb2f87221798b3fee5fd4c788fa3beaf63`,
`latest-mac.yml`
`fc75da5949b3fcf12e3b1ac45feb714f1b983094c62a1c6c8b20bf18d25d1b3c`,
`latest-linux.yml`
`2138060fbedb23f3d7a090238634fd0cbd8388db674f80de5cd016093bd47b6f`,
and generated Windows `latest.yml`
`ed9b4ef11bd3a3a998b12da11febb755f64427d43bb33ea32e7bcb45acd324dc`.

Package size stayed effectively flat versus 1.6.1: each principal artifact changed
by roughly one-hundredth of one percent or less. That is distribution-size neutrality,
not a claim about runtime cost. The runtime-efficiency claim rests on reduced scan,
journal, retry and historical-state work plus the new field-measurement rail.

The only remaining publication boundary is owner release creation/tag publication
and verification of the public inventory. AoE2WAR web metadata must not advertise
1.6.2 before that public evidence exists.

## Release acceptance and field-soak boundary

### Required before publication

- **COMPLETE** — dependency audit, runtime lint, Watcher contracts and Electron
  package smoke are green on the exact build source.
- **COMPLETE** — historical-import contracts prove disk-backed one-at-a-time
  snapshots, bounded state, stable-failure advancement and one end-of-batch
  settlement persistence.
- **COMPLETE** — update lifecycle contracts preserve replay/import/upload/stream
  ownership and renderer recovery remains bounded to one dashboard reload.
- **COMPLETE** — renderer readiness/failure telemetry and diagnostic redaction
  contracts are green.
- **COMPLETE** — Windows installer + portable, macOS DMG + direct ZIP, and Linux
  AppImage are built from one source-bound build commit; Windows Azure signing and
  configured macOS/Linux policy are preserved.
- **COMPLETE** — all five user-facing artifacts plus updater/support metadata are
  cryptographically certified. **PENDING OWNER HANDOFF** — public GitHub release
  publication and post-publication inventory verification must occur before public
  application metadata advertises 1.6.2.

### Field evidence intentionally collected by 1.6.2

- Collect real Windows/macOS idle, normal replay, historical import and native-stream
  CPU/RAM/wakeup/payload profiles from the new instrumentation and use p50/p95 evidence
  to tune the next Watcher version.
- Exercise very large replay libraries in the field before replacing the conservative
  five-minute full-census failsafe with event-maintained metadata.
- Continue the macOS one-action verified updater only when Apple signing/notarization
  trust can be preserved; convenience does not override release provenance.
- Treat any system-power measurement as controlled external evidence. `powerWatts`
  stays null in 1.6.2.

The 1.6.2 release claim is therefore structural rather than theatrical: lower passive
I/O and telemetry churn, bounded memory state, stronger diagnostics and recovery, with
no invented promise that every machine consumes a specific number of watts.
