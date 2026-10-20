---
id: "aoe2war.aoe2-watcher.readme"
title: "aoe2-watcher"
type: "reference"
status: "active"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher","api-prodn"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "git"
authority: "repository-entrypoint"
reviewed_at: "2026-10-19"
review_interval_days: 60
sensitivity: "internal"
---

# aoe2-watcher

## v1.6.5 public release

Watcher 1.6.5 is the current public release. The five-artifact publication gate completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. The immutable `v1.6.5` release and its updater metadata were verified before publication.

GitHub published `v1.6.5` on **2026-10-19 at 20:13:38 UTC**, with all five principal artifacts plus `SHA256SUMS-1.6.5.txt`, `watcher-release-manifest-1.6.5.json` and platform updater manifests. The release records build source `b49f31bb69fea629378072faa22220cdfcc2f1ef`, Windows signing run `39315028329` and Mac/Linux build run `39315028352`. Windows installer and portable are Azure-signed and timestamped as described in the public release; the macOS DMG/direct ZIP and Linux AppImage are intentionally unsigned. Do not claim macOS notarization.

**Boundary:** GitHub publication alone does not prove website download-vault parity or end-user adoption; those are separate checks. War Satchel and Auto Bets remain preview-only and financial production remains held.

## Watcher 1.6.5 release policy — owner decision (2026-10-19)

**Permanent release rule until owner explicitly changes it:** Windows NSIS and
portable binaries are **Azure Artifact Signed and RFC3161 timestamped**. macOS
DMG and direct ZIP are intentionally **unsigned and not Apple notarized**.
AoE2WAR does **not** hold a paid Apple Developer membership/certificate and
must not ask the owner to purchase the USD $99/year plan merely to release
Watcher. Revisit Apple Developer signing **only after the project earns
revenue and the owner approves the expense**. Linux AppImage remains unsigned.
Never mislabel an unsigned Mac build as Developer ID signed, notarized or
automatically installable. Publish artifact identities and SHA-256 checksums;
Mac users may see Gatekeeper warnings and should verify the authentic release
before opening. Never advise disabling Gatekeeper or removing quarantine.

War Room v1.6.5 provides a French (FR) and English (EN) toggle; a matching
French OS setting selects French when no explicit local override exists.
An **authenticated** profile locale takes priority over OS locale once the
website exposes a separately reviewed, paired Watcher owner-summary API.
The current live website lacks that route, so **website-profile automatic
language sync and avatar synchronization are not yet live**. Never infer
locale, profile or avatar from a Watcher key's presence or a claimed player
name. A verified summary is allowed to supply a first-party avatar and
language; a local language override takes priority and can always be changed.

War Satchel and Auto Bets are **website-owned financial features**. The
Watcher displays a read-only, accurately labelled pending-activation tile
linking to profile settings. It never holds WOLO, creates a custody vault,
signs financial transactions or places bets. App PR #684 and the WoloChain
financial review are held pending independent security controls; a successful
Watcher release must not activate or falsely certify that separate system.

## Watcher 1.6.5 — pre-publication integration candidate (historical October 19, 2026)

This historical candidate combined the original 1.6.5 development lineage
with War Room and preserved the bounded runtime diagnostic coalescer from
production `main`. The public `v1.6.5` release above supersedes this
pre-publication status. The owner explicitly approved **unsigned, unnotarized**
macOS builds rather than a paid Developer ID requirement; Windows retained
Azure signing. Publication does not itself certify website download-vault
parity or retroactively resolve legacy Replay Truth unknown games.
The complete 1.5.10-to-1.6.5 migration path still requires evidence from a
real installed v1.5.10 machine; tests of a v1.6.4 upgrade do not prove it.

War Room and original Old Blue share the same recorder and replay engine.
War Room's manual full-display Go Live adds single-use explicit consent; a
verified player-data read-only endpoint is **not** implemented in this candidate.
Do not infer player results, audience sizes or financial operations from uploads.

## 2026-10-15 — Runtime diagnostic coalescer memory bound (candidate source)

The Watcher is intended to create barely measurable background CPU/memory
load, especially when no replay is being uploaded. Its runtime event
coalescer already collapses repetitive `replay-detected-ignored/monitoring`
diagnostics into 30-second windows but previously retained every distinct
replay filename indefinitely unless that exact identity emitted
`monitor-stop`. On a long-running process this could grow in memory without
a release-specific or timed bound.

The source candidate now retains at most **512 recent distinct diagnostic
keys** (configurable for tests, hard capped), using insertion-ordered
LRU-style eviction on new/active keys. Eviction can cause an *extra* diagnostic
event on a previously forgotten replay; it cannot suppress or transform
upload, winner/finality, monitoring stop or financial messages. It adds
**no new polling timers, file scans, durable I/O or network egress**.
The durable telemetry queue remains independent and preserves its
atomic file/stop-retry semantics. Dedicated tests exercise 5,000 unique
replays, small-cap hot-key retention, stop reset, cap clamps, and original
coalescing windows.

At this October 15 source checkpoint the change was **not yet** a published
Watcher release; `v1.6.4` remained the public artifact authority then.
The subsequent `v1.6.5` GitHub publication is recorded above, independently
of website download promotion or client adoption. Do not infer wattage savings
from synthetic tests; field power and idle wakeups require release-bound telemetry.

## Public release authority (reviewed 2026-10-13)

At this October 13 review, the latest publicly published GitHub release was
**v1.6.4**, published 2026-10-10 22:37:46 UTC at tag
`a223ad41c1a877e30e6f532c915aa40499d2c746`.
GitHub lists twelve files including the Windows installer/portable, macOS
DMG/direct ZIP, Linux AppImage, and SHA-256 release inventory. The release
description explicitly states the production promotion is a separate step:
the public GitHub listing alone is **not** proof that aoe2war.com has promoted
those bytes, or that users upgraded. Validate production download metadata,
signed inventory and client telemetry independently.

The 1.6.2 and 1.6.3 audits are now historical release evidence, with no
rolling active-development review deadline. Do not retroactively reinterpret
their measurements, SHA-256 proof, winner-finality semantics or field dates.
For new development, create a new source-bound active plan and dated review
instead of reopening a superseded version-specific plan.

## Development dependency security checkpoint (2026-10-13)

The frozen Watcher CI reported GHSA-ch52-4w7c-c8xp against
`http-cache-semantics@4.2.0`, a **development-only transitive dependency** in
the Electron builder dependency graph. The reviewed lockfile now pins a single
verified-integrity `4.3.0` package without changing the Electron builder,
Watcher source, binary release, or runtime cache design. This is outside the
advisory's declared affected range (through 4.2.0) and must pass the existing
unweakened `npm audit --audit-level=high` and full CI. It is *not* a blanket
security guarantee: external cache-policy research questions whether upstream
4.3.0 fully addresses all `max-stale` counterexamples. Any true runtime
shared-cache use would require additional threat-model evaluation. The Watcher
does not gain a server-side shared HTTP cache from this development dependency.


## v1.6.3 public release (historical)

Watcher 1.6.3 was a previous public release. The five-artifact publication gate completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. The immutable `v1.6.3` release and its updater metadata were verified before publication.

The release prevents duplicate monitor ownership for one replay, backs
established live uploads from the initial fast cadence to a one-minute cadence,
keeps low-frequency update discovery alive while the background Watcher runs,
surfaces manual Mac update actions without weakening artifact provenance, and
preserves the server distinction between durable final bytes and an accepted
competitive result. A final replay stored for review is no longer described as
fully settled merely because its bytes stopped changing.

Certified 1.6.3 evidence:

- runtime source: `22397221167bac75c710804d526d33cbdfe8d559`;
- cross-platform build source / `v1.6.3` tag:
  `ad44e34a49901aed58ee72bd922ea5b047b76870`;
- Windows Azure-signing run: `37042601127`;
- macOS/Linux build run: `37042597135`;
- certification run: `37043600091`;
- certified bundle artifact: `certified-watcher-release-1.6.3`;
- certified bundle artifact ID: `11242987071`;
- public GitHub release published: `2026-10-02T18:00:05Z`.

The five principal user-facing bytes are bound by SHA-256 in the certification manifest. The immutable `v1.6.3` public release inventory has been verified, so downstream release metadata may promote only those exact certified bytes.

The engineering evidence and measured no-change decisions live in
[Watcher 1.6.3 Development](docs/WATCHER_1_6_3_DEVELOPMENT.md).


## v1.6.2 public release

Watcher 1.6.2 was a prior public release. The five-artifact publication gate
completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP,
and Linux AppImage. The immutable `v1.6.2` release and its updater metadata were
verified before publication. Its engineering goal remains deliberately paradoxical:
do less background work while exposing more useful truth.

The steady-state reductions are structural. Passive replay-folder status caching moves
from one minute to five minutes; runtime-event diagnostics batch bounded asynchronous
writes instead of synchronously appending every event; healthy durable telemetry no
longer rewrites empty or no-progress queue state; historical scans stop allocating
state for every archived replay and persist one bounded settlement snapshot per batch.
Settled runtime state is capped by both the existing 5,000-entry limit and the 90-day
age contract without pruning active work.

The new resource profiler samples the Electron process tree every 15 seconds only
while replay/import/upload/stream work is active and backs off to 60 seconds when the
Watcher is otherwise idle, even with the dashboard open. CPU, working-set RAM,
processor wakeups, payload-attempt rate, and a non-watt power signal are visible in
Diagnostics. Remote telemetry carries a compact support subset on the existing
one-minute heartbeat only; ordinary replay lifecycle events do not carry the resource
profile.

A Sep. 29 Windows 1.6.1 field report from Tekki exposed a separate support blind spot:
the replay engine remained authenticated, heartbeating, monitor-attached, and pointed
at a valid active HD folder while the desktop window stayed on the static
"Loading watcher…" placeholder even after a cold process restart. 1.6.1 treated
Electron `did-finish-load` as renderer readiness, which proved only that HTML loaded.

1.6.2 replaces that assumption with an explicit renderer-ready handshake. The main
process records sanitized preload/page/renderer-process/bootstrap failures, exposes
renderer health in heartbeat/support metadata, waits a bounded 12 seconds for startup,
and performs at most one safe dashboard reload. Replay monitoring remains a separate
engine and is not restarted by dashboard recovery. If the renderer process itself dies
during optional native streaming, stale local stream state is cleared before that one
recovery attempt because the renderer-owned MediaRecorder is already gone.

This release does **not** claim measured universal watt or CPU savings. Electron does
not expose defensible portable per-process watts, and real-machine p50/p95 resource
evidence will be collected from 1.6.2's new instrumentation during field soak. The
release claim is narrower and testable: less passive filesystem/disk/telemetry churn,
bounded historical memory state, stronger self-recovery, and substantially better
remote support diagnostics without asking gamers to use developer tools.

The engineering audit and release evidence boundary live in
[Watcher 1.6.2 Engineering Audit](docs/WATCHER_1_6_2_AUDIT.md).

Certified 1.6.2 evidence:

- runtime source: `1d1e9b3ca9f95a89cf47ab582219e4c85b725603`;
- cross-platform build source: `b1e3b1353aa48840bdaa7d8afc353e1afc5bf22d`;
- Windows Azure-signing run: `36649412730`;
- macOS/Linux build run: `36649412594`;
- certified publication-bundle run: `36649765669`;
- certified bundle artifact: `certified-watcher-release-1.6.2`;
- certified outer artifact digest:
  `39123c7f47adcde308be83ee904f9c5ca4319c793b5911a05b3d7600c82449f4`.

The five principal user-facing bytes are bound by SHA-256 in the certification
manifest. The immutable `v1.6.2` public release inventory was re-verified after
publication, and AoE2WAR's production download vault was proven byte-for-byte
against that certified public inventory before downstream metadata promotion.

## v1.6.1 public release

v1.6.1 bounds historical batch-import memory and retry behavior after a Windows
1.6.0 field report showed the Watcher reaching roughly 17 GB of memory while
continuously importing old replays.

Historical imports now use one disk-backed immutable upload snapshot at a time
instead of retaining each replay body in a Node Buffer. Network/fallback retries
reuse that disk snapshot and it is removed when the file finishes. Deterministic
HTTP 422 parser/validation failures from a stable historical replay do not enter
the live-replay growth retry loop; the importer records the failure and advances
to the next replay. Live growing-replay uploads keep the existing in-memory
snapshot and progress-retry contract.

The historical queue remains serial and oldest-first. No replay is deleted, and
the hotfix does not change result, betting, settlement, or Wolo authority.

Watcher 1.6.1 was a prior public release. The certified release binds runtime
source `3f8982d0f9c3f28540ec49adacad5418de065adc` to build source
`eb8c7478575b472273b4400f01c4d401df03e2c5`, Windows signing run
`35808959038`, macOS/Linux build run `35808958815`, and certified bundle run
`35809312675`. The public inventory contains the five user-facing platform
artifacts plus updater/support metadata, `SHA256SUMS-1.6.1.txt`, and
`watcher-release-manifest-1.6.1.json`.

## v1.6.0 public release

v1.6.0 is the low-footprint lifecycle release. Native `fs.watch` remains the
primary replay detector; recovery scans and folder-health checks are slower
failsafes rather than polling engines. Config and replay-folder metadata are
cached so telemetry does not repeatedly rescan disk state.

Watcher 1.6.0 is the previous public release. The five-artifact publication gate completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. The immutable `v1.6.0` release and its updater metadata were verified before publication.

The release also bounds dashboard logs, coalesces bursty runtime-event paints,
uses a sandboxed renderer, removes the unused chokidar dependency, upgrades the
Electron/build toolchain to security-patched versions, and keeps the v1.5.13
replay durability and fresh-replay recovery rules intact.



## v1.5.13 public release

Watcher 1.5.13 fixes a live-replay admission failure observed simultaneously on Scavanger_Ab and Tekki. A supported HD `.aoe2mpgame` could be present and freshly modified while the Watcher remained connected and attached yet reported no active replay. Two causes were proven: English `Out of Sync` filenames were explicitly rejected, and restart/resume recovery required an unknown replay to grow during one 1.5-second sample before monitoring it.

Watcher 1.5.13 was a prior public release. The five-artifact publication gate completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. The immutable `v1.5.13` release and its updater metadata were verified before publication.

The source version is `1.5.13`, but public Windows, macOS, and Linux metadata must remain on `1.5.12` until fresh platform builds, Azure Windows signing, artifact hashing, updater-manifest verification, and the five-artifact publication gate all complete.


## v1.5.12 public release

Watcher 1.5.12 hardens Windows HD replay-folder discovery and diagnostics. Windows now consults Steam registry install roots before reading `libraryfolders.vdf`, so a custom Steam install can still lead the Watcher to the active `Age2HD\SaveGame` / `multi` directory. Heartbeat and ready telemetry also separate structural HD-folder validity from proven replay activity by reporting supported replay count, newest replay metadata, and an activity-proof flag without transmitting the full local path.

Watcher 1.5.12 was a prior public release. The five-artifact publication gate completed for Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. The immutable `v1.5.12` release and its updater metadata were verified before publication.

## v1.5.11 historical release candidate

Watcher 1.5.11 adds capability-negotiated server media shedding for watcher-native video. Updated clients advertise `server-media-shed-v1`; when AoE2WAR returns terminal `STREAM_MEDIA_SHED`, the Watcher stops optional native video cleanly while replay/API transport remains authoritative. Older Watchers do not advertise the capability and therefore keep the prior server behavior during rollout.

At that stage, the source version was `1.5.11` while public artifacts remained `1.5.10` until the five-artifact release gate completed.

## v1.5.7 upload snapshot contract

v1.5.7 binds every upload request to one immutable in-memory replay snapshot. The request body, `Content-Length`, `x-file-size-bytes`, and replay fingerprint are all derived from the same captured bytes, so AoE2HD may continue appending to the source replay without causing a false `409 Replay changed while it was being uploaded` mismatch. After upload, the watcher rechecks the source fingerprint and schedules the next live iteration when growth continued.

Upload queue telemetry now counts one logical live/final upload per replay. Retries and fallback targets reuse that queue position instead of inflating `uploadQueueLength`.

## Monitoring notification telemetry coalescing

Native filesystem watchers, especially on Windows, may emit many change notifications while the watcher is already monitoring the same growing replay. Those notifications still reach the local runtime journal and UI, but remote `replay_detected_ignored` telemetry with reason `monitoring` is coalesced to at most one event per replay every 30 seconds. Periodic summaries include the raw notification count represented by that event.

Watcher recovery is filename-language agnostic: any supported replay extension can enter monitoring, including HD multiplayer out-of-sync save names. On startup, resume, or monitor reattach, the recovery scan adopts the newest fresh unknown supported replay even if it does not happen to grow during the 1.5-second sampling window. Persisted known-final replays retain fingerprint/content-hash short-circuit protection.

Replay detection, upload attempts and receipts, file-growth transitions, final-candidate transitions, and monitor-stop events are never coalesced. The correction changes support telemetry load only; it does not alter the replay polling loop, live-upload cooldown, final-stability checks, or final upload timing. That telemetry-only change did not advance public artifacts by itself.


<!-- AOE2WAR:TERMINAL_RESULT_RECEIPT_SOURCE_V3:START -->
## Terminal result receipt source contract

After the final replay settle-observation window, the Electron main process now
preserves `finalStored` and `settleWindowMs` when forwarding runtime events to
remote telemetry. This allows the app to retain an exact
`final_settle_observation_complete` receipt tied to the same replay/session/file
identity used by the final upload.

The receipt is corroborating transport evidence. The Watcher does not decide
which player won. Server policy may use exact final 1v1 action-tail evidence
without a receipt, but a supplied conflicting receipt blocks automatic result
recovery. Any accepted automatic result is stats-only and cannot authorize a
market or chain action.

That historical source commit did not change the advertised desktop version; it still required a separate build, test, signing/staging, manifest-sync, and publication gate.
<!-- AOE2WAR:TERMINAL_RESULT_RECEIPT_SOURCE_V3:END -->

## Post-v1.5.10 live diagnostics hardening

Current source keeps parser diagnostics phase-aware. A live partial replay may
legitimately lack winner proof while the match is still in progress, so those
winner-only gaps are not emitted as unknown parse fields until the upload is
final. Populated player arrays are traversed structurally rather than treated as
objects that should themselves expose a `name`. Structural live gaps such as an
unknown map or an unknown player name still surface immediately, and an
unresolved winner on a final replay remains diagnostic truth.

That historical hardening was source-only; every public Watcher version still requires the full five-artifact release gate.

## v1.5.4 reliability contract

Connection and replay monitoring are independent states. A heartbeat proves connection only. v1.5.4 heartbeats additionally report monitor attachment, HD-folder validity/classification, recent folder activity, current replay basename/size/change time, replay detection/upload state, queue depth, batch state, stream state, version, platform, watcher ID, and session ID. Full filesystem paths and replay contents are not sent as telemetry.

On launch, saved identity, folder, and auto-start preference are restored. The app verifies that the folder is readable and resembles an AoE2 HD SaveGame directory, attaches Chokidar, emits explicit start/ready events, and scans recent files twice for growth evidence. This recovers a game already underway without treating an old archive as live. Windows detection checks normal, OneDrive consumer/commercial, profile Documents, Steam registry install roots, and `libraryfolders.vdf`, and never silently selects AoE2 DE.

The 30-second watchdog handles absent monitors, inaccessible folders, and sleep/wake with three bounded reattach attempts and a one-minute cooldown. File stability creates only a final candidate; monitoring suppresses future uploads only after trusted server acceptance. Deferred/unparsed final proof remains visible, and later file growth reopens monitoring.

Batch import uploads supported HD replay files oldest-to-newest, hashes/deduplicates, persists summary/failures, and supports retry. Its counters deliberately separate upload receipt, confirmed archive storage, completed parsing, result-ready acceptance, and private review routing. A 2xx receipt alone never marks a final result ready. Streaming, batch work, and live monitoring remain separate rails.

Release exactly five artifacts: Windows Installer, Windows Portable, macOS DMG, macOS Direct ZIP, and Linux AppImage. Before publishing, run `npm run lint`, `npm test`, and `npm run dist:release`; record SHA-256 hashes, verify updater YAML and embedded version, verify Windows Authenticode/timestamping, and follow the configured macOS signing/notarization policy. Public metadata advances only after all five artifacts are present.

Troubleshooting order: confirm `Connected · Watching`, confirm `Folder valid`, inspect latest replay activity, use Detect Again/Choose Folder, then inspect upload and finality. `Connected · Monitoring stopped` is not a server/parser failure.

Electron helper that watches your AoE2 replay folder, emits live replay snapshots while a match is in progress, uploads the final replay when the file settles, and can scan/import older saved replays on demand.

This is the client-side edge of the AoE2HDBets replay loop. It is intentionally allowed to be a little chatty while the live replay flow is still being refined.

## What changed

- Firebase has been removed completely
- uploads now go directly to `/api/replay/upload` on your configured API base
- live watcher uploads now mark non-final replay iterations so `/live-games` and lobby-adjacent surfaces can light up before the match ends
- uses `x-user-uid` header for identity
- optional `x-api-key` support via `AOE2_UPLOAD_API_KEY`
- supports one-click profile pairing through `aoe2hd-watcher://pair?apiKey=...`
- supports `.aoe2record`, `.aoe2mpgame`, `.mgz`, `.mgx`, and `.mgl`
- retries transient parse/upload failures automatically
- treats final uploads as server-verified candidates; a replay is only considered settled when the API returns `should_settle=true`
- reopens a final candidate automatically if the replay grows after a prior upload
- skips duplicate re-uploads only after a final was accepted by the server
- adds a first-class `Scan & Import Replays` flow for historical saved games
- persists the last import summary, failed uploads, replay folder, watcher key, and auto-start preference locally
- packages Windows x64 releases with both NSIS installer and portable fallback targets
- packages a Linux AppImage fallback from the same watcher core
- emits rich support telemetry for app opens, auth, heartbeat, monitor lifecycle, file growth, final deferrals, upload retries, parse results, and batch import lifecycle
- checks the public watcher release endpoint and shows either an Update button or a clear Latest Version label in the main window
- v1.5.0 hardens watcher-native streaming with display-first macOS full-screen guidance, one-second chunks, explicit keyframe cadence, upload backpressure, rolling AoE2WAR playback, better stale-live handling, and richer stream telemetry
- signed Windows builds can update in place when idle; unsigned macOS builds use download-and-replace until Developer ID signing/notarization is worth doing
- keeps the browser streamer as a fallback for watcher-detected games
- current behavior can emit multiple live iterations before a final settled upload, which is expected during active development

## Quick Start

```bash
cp .env.example .env
npm install
npm run start
```

`npm run start` loads `.env` automatically.

The desktop app still expects a watcher key before uploads begin. The default path is one-click
pairing:

1. launch the app
2. click **Open Profile Pairing**
3. approve the `aoe2hd-watcher://` handoff in your browser

That mints a fresh watcher key on `https://aoe2war.com/profile?watcher_pair=1`, saves it to the
local app config, and auto-starts when the replay folder is already known. If macOS blocks the
custom URL, use **Mint Key Only** on `/profile` and paste the fallback key into the app once.

## Historical import

The main window now includes **Scan & Import Replays**.

- scans the configured replay folder with the same replay extension rules the watcher trusts
- processes files oldest-to-newest
- keeps live watching available
- shows uploaded / archived / parsed / result ready / private review routed as separate milestones, alongside queue, skip, and failure counts
- stores failed uploads so they can be retried from the same UI

## Watcher-native streaming

When the watcher sees a live replay candidate, the main window enables **Start Stream** and **Go Live**.
The watcher lists capturable windows/screens, prefers likely AoE2HD/CrossOver/Steam/Wine sources, starts
a local preview, creates an AoE2WAR stream session with the watcher key, and uploads short WebM chunks to
the app. v1.5.0 uses one-second chunks, asks Chromium for frequent keyframes, applies upload
backpressure so slow networks skip stale slices instead of dragging the live rail behind the match, and
feeds AoE2WAR's rolling WebM playback route so viewers recover from missing chunk gaps instead of
stalling at the live edge. The stream readout shows the latest capture/upload/heartbeat status so a user
can see whether the source stopped, permissions failed, the network is catching up, or chunks are flowing.

Replay delivery outranks optional video. The watcher already pauses or drops local video while its own replay transfer owns network priority. Updated builds also advertise the `server-media-shed-v1` stream capability. When AoE2WAR replies with terminal `STREAM_MEDIA_SHED`, the watcher stops native capture cleanly, preserves replay transport, and tells the user when to start a fresh stream. Older builds do not advertise that capability, so automatic server replay-pressure shedding is not applied to them; an operator emergency kill switch may still force video shedding server-side.

Use **Full Screen** mode when AoE2HD is running through CrossOver or when the game window disappears from
macOS capture after entering full screen. macOS defaults to Full Screen mode and labels screen sources as
Display capture; go live, then switch to AoE2 full-screen. Stable and Sharp still prefer window capture
when a windowed game is the better source.

The **Browser** button remains a fallback. It opens
`https://aoe2war.com/profile?watcher_stream=1&stream_session=...&stream_title=...`, preserving the
detected match through Steam login and landing the user in the AoE2WAR browser stream studio.

## Optional environment variables

- `AOE2_API_BASE_URL` (default: `https://api-prodn.aoe2war.com`)
- `AOE2_API_FALLBACK_BASE_URL` (default: `https://aoe2war.com`)
- `AOE2_TELEMETRY_BASE_URL` (default: fallback base URL)
- `AOE2_WATCH_DIR` (default: platform-specific AoE2HD SaveGame path)
- `WATCHER_USER_UID` (default: hostname-derived watcher id)
- `AOE2_WATCHER_ID` (optional stable watcher id override; generated and persisted by the app normally)
- `AOE2_UPLOAD_API_KEY` (optional manual fallback; one-click pairing normally fills this in)
- `AOE2_WATCHER_RELEASE_BASE_URL` (optional release-check override; default: `https://aoe2war.com`)
- `AOE2_TELEMETRY_HEARTBEAT_MS` (default: `60000`)
- `AOE2_UPLOAD_RETRY_ATTEMPTS` (default: `4`)
- `AOE2_UPLOAD_RETRY_BASE_DELAY_MS` (default: `4000`)
- `AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS` (default: `3000`)
- `AOE2_UPLOAD_QUIET_PERIOD_MS` (default: `18000`)
- `AOE2_INITIAL_LIVE_DELAY_MS` (default: `3000`)
- `AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS` (default: `10000`)
- `AOE2_LIVE_UPLOAD_COOLDOWN_MS` (default: `30000`)
- `AOE2_FINAL_CANDIDATE_MIN_AGE_MS` (default: `30000`)
- `AOE2_FINAL_CANDIDATE_COOLDOWN_MS` (default: `45000`)
- `AOE2_FINAL_CANDIDATE_STABLE_SAMPLES` (default: `2`)
- `AOE2_FINAL_SETTLE_WINDOW_MS` (default: `180000`)
- `AOE2_FINAL_SETTLE_POLL_MS` (default: `10000`; low-frequency post-final observation)
- `AOE2_RECOVERY_SCAN_INTERVAL_MS` (default: `60000`; missed-event safety net)
- `AOE2_MONITOR_WATCHDOG_MS` (default: `60000`)
- `AOE2_REPLAY_FOLDER_FRESHNESS_PROBE_MS` (default: `300000`)
- `AOE2_FOLDER_STATUS_CACHE_MS` (default: `60000`)

Existing watcher installs that saved the retired `aoe2hdbets.com` endpoints migrate those
settings to `aoe2war.com` on next launch.

## Update indicator

The watcher fetches `https://aoe2war.com/api/watcher/release` on launch and after settings saves.
When the installed version is behind the public release metadata, the Build card and Diagnostics
version row show **Update** and open the best platform download path. When it is current, those
same locations show the installed version followed by **Latest Version**.

On Windows, signed releases can download and install in place when the watcher is idle. On macOS,
the current unsigned builds use download-and-replace. That can change later if Developer ID signing
and notarization become worth the account cost.

## Optional env example

```bash
AOE2_API_BASE_URL=https://api-prodn.aoe2war.com
# optional if backend protection is enabled
AOE2_UPLOAD_API_KEY=your_key_here
```

## Current behavior notes

A normal successful session can look like this:

1. replay file appears
2. watcher emits one or more live uploads while the file is still growing
3. backend may store non-final/live state first
4. watcher waits for file quiet/stability
5. watcher sends a final candidate
6. backend either defers it, preserves non-settling proof, or accepts it as settlement-safe final data
7. watcher keeps monitoring until the final candidate is accepted and the replay remains unchanged

This means multiple live iterations in logs are not automatically a bug.

## Logging notes

Current watcher logs are intentionally useful while building. Expect to see messages about:

- file growth / quiet-period waiting
- live iteration numbers
- final-candidate readiness, deferral, acceptance, and reopen events
- transient retry behavior
- minimum parseable-size thresholds

That noise is acceptable during active development because it makes replay timing issues much easier to understand.

## Build release artifacts

```bash
npm run dist:release
```

`npm run dist:release` builds:

- the unsigned macOS DMG
- a direct ZIP that contains the same `AoE2HDBets Watcher.app` bundle as the DMG
- the Windows installer and portable EXE
- the Linux AppImage

The direct ZIP is the legitimate fallback while Apple signing and notarization are offline. It is
not a reduced feature path.

Do not advance the web app release metadata until the signed Windows artifacts and staged Mac/Linux
artifacts exist in `dist/` and have been synced with `npm run watcher:sync` from `app-prodn/`.

## Build (Windows x64 from macOS)

If Wine is not installed locally, use Docker with the Electron Builder Wine image:

```bash
docker run --rm --platform=linux/amd64 \
  -e ELECTRON_CACHE=/root/.cache/electron \
  -e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
  -v "$PWD":/project \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -lc 'npm ci && npx electron-builder --win nsis portable --x64'
```

That produces:

- Windows NSIS installer
- Windows portable fallback executable

## Build (Linux AppImage)

```bash
npm run dist:linux
```

That produces:

- Linux AppImage package
