---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-4-update-lifecycle"
title: "Watcher 1.6.4 Update Lifecycle Development"
type: "working"
status: "active"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "git"
authority: "watcher-update-lifecycle-contract"
reviewed_at: "2026-10-08"
review_interval_days: 30
sensitivity: "internal"
---

# Watcher 1.6.4 Update Lifecycle Development

This work continues `feature/watcher-1.6.4-auto-television` from
`a54e9935b05b2cb5ec7988523e3303819c9171e2`. It preserves the existing
auto-Television implementation. No release, tag, publication or deployment is
authorized by this document. The package and lock now identify the **1.6.4 release candidate** so unsigned Windows packaging is version-true. This does not certify or publish v1.6.4; the public release remains 1.6.3.

## Workload and handoff contract

Background discovery retains its six-hour schedule and supported platforms
download through electron-updater. A downloaded update waits for replay work,
initial/recovery scans, uploads, historical imports and native streaming to
finish. Monitoring that is armed but idle may be stopped briefly for install.
The user may click Update, or an idle completion event may start installation.

The installer serializes clicks, downloaded timers and completion events. It
fences new monitor/import/stream admission, stops idle monitoring and timers,
flushes the runtime journal, checks for remaining work, then requests
`quitAndInstall(false, true)`. `autoRunAppAfterInstall` is explicitly true.
Successful return from this void API proves only handoff, never activation.

Normal quit with a downloaded update uses the same safe seam. The upstream
install-on-quit switch is false while work is active and during handoff.
macOS staging is app-managed, so the upstream switch stays false there.
Signed Mac updates are staged through Electron's public native updater first;
only its native `update-downloaded` event permits the wrapper quit request.
This avoids an internal delayed quit callback while Squirrel is still fetching.
Native readiness must match the single immutable candidate version and local
Squirrel feed binding, including the public event's ZIP URL. A failed native
stage retains manual replacement until process restart; its late events cannot
authorize another candidate or force quit.

Journal or installer errors restore the prior monitoring state and runtime
timers while the process remains alive. An error during asynchronous journal
drain revokes that handoff before any quit request. A queued BaseUpdater quit
after an installer error is vetoed once. Errors before installer invocation
may retry; errors after invocation retain manual replacement until restart
because upstream can retain a private install latch. The app never resets that
private state or claims cancellation. Failed journal chunks remain in memory ahead
of newer chunks until append succeeds; retry clears the error only after the
pending writes drain. This is diagnostic evidence retention, not a new result
or competitive-truth authority. Persistently unwritable storage holds update
handoff. Memory-held failed chunks are not a crash-safe backup.

Monitor generations invalidate stale initial/recovery scans and filesystem
admissions after stop/restart. Current scans and pending replay identity work
and every owned replay monitor are included in the busy observation. One
monitor finishing cannot declare another monitor idle. Historical import semantics remain
unchanged. Opted-in automatic capture retains an unthrottled hidden renderer;
ordinary dashboards still use background throttling and sandbox isolation.

## Platform requirements

| Platform | Development behavior |
| --- | --- |
| Windows installed NSIS | Background download, safe idle install and updater-owned relaunch. Portable execution uses manual replacement. |
| macOS unsigned or not opted in | Manual download/replacement; no ShipIt quit request. |
| macOS opted in, signed and notarized | Verify the running bundle, stage the signed update, then install only after native readiness and idle workload. |
| Linux packaged AppImage | Supported updater path only with its real absolute `APPIMAGE` binding. Other execution uses manual replacement. |

`AOE2_ENABLE_MAC_AUTO_UPDATE=1` alone does not prove eligibility. The running
bundle must pass bounded, shell-free `codesign --verify --deep --strict`, expose
a Developer ID Application authority, and pass Gatekeeper assessment as
Notarized Developer ID. Failures retain the manual path. No signature checks,
Gatekeeper policy, entitlements or Electron sandbox protections are disabled.

True macOS self-update still requires a release pipeline that produces a
Developer ID signed/notarized **electron-builder ZIP** and matching
`latest-mac.yml` with valid hashes/signature compatibility. The current explicit
DMG target and separately wrapped manual ZIP do not establish that contract.
The release pipeline is unchanged in this tranche. See the owning
[electron-builder updater requirements](https://www.electron.build/v26/docs/features/auto-update/)
and [Electron native updater contract](https://www.electronjs.org/docs/latest/api/auto-updater).

The generic feed is additionally gated to a valid stable version strictly newer
than the running version, while preserving upstream OS-support checks.
Downgrades and prereleases are disabled; no channel setter is used because it
can implicitly enable downgrades. Existing updater digest/signature verification
and AoE2WAR artifact certification remain unchanged.

## Process and resource evidence

A read-only observation at 2026-10-08T15:27:11Z found installed version 1.6.3:
main PID 581, GPU helper 593 and sandboxed NetworkService helper 594. Both
helpers had parent 581. Each sampled 0.0% CPU; combined RSS was approximately
96 MiB. No duplicate main or orphaned Watcher helper was observed.

`requestSingleInstanceLock` still owns application admission. Subsequent starts
forward pairing/focus only. Electron owns its renderer/GPU/utility children;
no helper is killed individually. Closing the dashboard may leave the tray
runtime and expected GPU/network helpers alive. Opted-in capture deliberately
retains a hidden renderer. Live application exit/update teardown was not run
against the installed application, so this observation is not teardown proof.

Existing resource samples now expose a local `processTopology`: bounded PID,
creation time, role, optional sandbox state and service/name fields. Browser
main count is separate from helper count. The scope is this Electron
application; it cannot establish global uniqueness or orphanhood. This detail
is excluded from compact remote resource telemetry.

No new idle timer was added. Existing idle sampling/heartbeat/watchdog and
five-minute folder probes remain; no evidence justified changing them.

## Cleanup and validation boundaries

No new updater cache deletion or installed-copy search is implemented.
electron-updater owns its configured pending/cache lifecycle and differential
download material. It offers no reviewed public post-activation cleanup API
here. Private helper calls or guessed cache paths would weaken ownership.
Pairing, config and user data paths are unchanged. Upstream installer replacement
is retained; no universal atomic filesystem rollback is claimed for NSIS,
Squirrel or AppImage from mocked source tests.

Node tests execute the actual main process in an isolated VM with fake Electron,
filesystem, network and timers. They cover single-instance admission, busy
deferral, idle resumption, duplicate requests, workload races, evidence drain,
failure restoration, stale quit veto, native Mac readiness and platform/version
gates. Journal tests execute actual flush functions with an in-memory filesystem.
Delayed scanner tests exercise stopped/restarted monitor sessions. The renderer
tests preserve automatic capture and truthful update status/action presentation.

Local installed tooling at audit time was electron-updater 6.8.9, Electron
35.1.4 and electron-builder 24.13.3; package/lock declare the newer Electron and
builder versions. Source tests use Node and the inspected updater contracts;
they do not certify packaged behavior with the declared toolchain. Before
release, use the frozen toolchain and isolated platform update canaries to prove
replacement, relaunch, configuration preservation and helper teardown. No
installed Watcher, updater payload or production API was exercised here.

Final source validation on 2026-10-08: the full Watcher suite passed 185 tests
with zero failures or skips; lint and `git diff --check` passed. A separate
review reran the 39 lifecycle, 10 update-policy and 5 journal tests (54 passed).
The exact implementation/test file digests and validation observations are
preserved in `watcher-receipts/update-lifecycle-validation-20261008.json`.

## V1.6.4 Television integration hardening (2026-10-10 Git-only development)

This section extends the **unreleased** 1.6.4 source with Television V3
integration. The paired web counterpart is the dependent development
branch `feature/television-v3-integrated-hardening-20261010`. Neither
repository has been deployed or certified as a production video release.

- Explicit video launch: **Stream My Game**, **Start Video**, **Video Live**,
  **Stop Video**. Automatic match capture remains an independent opt-in
  setting; opening the Watcher or the Television viewer does not silently
  broadcast the user's desktop.
- Three source profiles remain Stable 720p/15 at 1.4 Mbps, Full Screen
  720p/18 at 1.8 Mbps, and Sharp 720p/24 at 2.6 Mbps. The UI reports
  theoretical encoder bytes per hour **before overhead**, not real egress,
  CPU impact or electricity. The companion server's proposed 3 GiB per-POV
  default must still pass physical long-game and mounted-volume canaries.
- The existing Electron sampler now accumulates **constant-memory local**
  resource cohorts for idle, armed monitoring, detected game, replay
  transfer and active streaming, including process-tree CPU%, working-set
  RAM and observed outbound payload rate. These are observations of the
  Watcher application, not the whole computer or a causal "extra watts"
  estimate. No samples are manufactured when Electron process metrics are
  unavailable; per-process power watts remain unknown.
- Native session identity is derived from the current candidate's
  session/replay, **never from an absolute local SaveGame path**. A
  server-visible weak `watcher:` session stays unlinked until the web API
  validates an exact replay/platform match owned by the authenticated
  user. Heartbeats may submit a newly discovered stronger claim, but may
  not bypass server authority. Never bind a current capture to a "recent"
  older game by timestamp.
- The authenticated heartbeat's `finality: replay_final` (or ended
  stream status) stops only video capture; gameplay/replay monitoring
  continues. A startup heartbeat that already reports finality cannot
  emit a false newly-live broadcast.
- CI now uses Node 24, runs lint/tests/packaging first, then a
  **still hard-failing** high-severity security audit. The development-only
  `http-cache-semantics` lock entry is upgraded to 4.3.0 with its npm
  package-integrity digest. Residual moderate dependency advisories
  remain to be separately reviewed; do not force Electron tooling
  version jumps without signed cross-platform installer canaries.

The Watcher Node suite includes executable native-session/path redaction,
phase-separated resource metrics, false power-claim checks, and explicit
video-only finality boundaries. Passing source CI **does not** certify
install/update/relaunch, actual capture permissions, two linked independent
Windows POVs, late-replay exact association, CPU/GPU/electricity impact, long
game retention, media decoding, or public video latency.

## Additional fail-closed video controls (2026-10-10)

- **Truthful chunk receipts:** A successful HTTP status alone is not a media
  receipt. Only the chunk endpoint's explicit `chunkCreated` boolean and
  server-authoritative `stream.chunkCount` count as recorded video.
  Idempotent duplicate WebM uploads retain the existing count.
  Late rejected network uploads and heartbeats from a prior capture are
  fenced out of the replacement capture's failure counters. A 200 response
  carrying `finality: replay_final` stops video-only capture instead of
  recording a phantom additional chunk. Late responses from a prior stream
  may not end or overwrite a replacement broadcaster.
- **Terminal failures:** The main-process stream bridge recognizes
  `STREAM_STORAGE_LIMIT`, `STREAM_CHUNK_TOO_LARGE`,
  `STREAM_FORMAT_UNSUPPORTED`, `STREAM_ALREADY_ENDED`, and the existing
  `STREAM_MEDIA_SHED` response contract. The renderer stops **video only**
  for terminal responses; temporary HTTP 503 remains distinguishable.
  Five consecutive recoverable video upload failures stop capture rather than
  letting MediaRecorder run indefinitely. The normal replay watcher remains
  attached.
- **Heartbeat finality:** An authenticated HTTP 409 carrying an already-ended
  stream is accepted only by the native stream heartbeat, not by arbitrary
  watcher requests. Ended/replay-final states still stop video alone.
- **Privacy-minimized telemetry:** Native video diagnostics leaving the app
  are restricted to bounded machine fields such as stream ID, capture mode,
  window-versus-screen kind, counters, reason codes, and timings.
  Arbitrary desktop/window/source titles, track labels, local paths,
  free-form exception messages, user-facing stream titles, and other
  unreviewed metadata fields are not sent through the video event helper.
  This is separate from the explicitly consented screen pixels.
- **Automated evidence:** Executable unit tests simulate finality 200,
  idempotent chunk acknowledgement, malformed successful replies,
  stale responses, terminal 409/413/415, retryable 503, and arbitrary
  privacy-sensitive metadata. They are regression evidence, not a live
  signed Windows capture or installed update canary.

The matching Television site/API must be deployed as a coordinated release.
Never infer deployability or real 2-hour quality from Node tests alone.

## Native Windows build parity gate (2026-10-10)

The 1.6.4 development PR's GitHub Actions CI now runs two mandatory
independent jobs: Linux runtime/contracts/audit/packaging, and
`windows-latest` full Node contracts plus actual **NSIS installer** and
**portable Windows EXE** packaging. The Windows job uses pinned npm
dependencies, never invokes the production website, never publishes binaries,
prints SHA-256 hashes for both candidate executables, and explicitly disables
certificate discovery for the **unsigned packaging smoke**. Passing it
establishes a native Windows build and contract pass, **not** a signed
installer, updater activation, actual AoE2 capture or video throughput test.

The first Windows run exposed two POSIX-only path literals in
`tests/watcher-session-lifecycle.test.js`. On Windows they looked up
different internal replay-entry keys because real `path.join` uses Windows
separators. The test now constructs its paths with the platform-native
path utility; **all original behavior assertions remain active**, including
stopped-monitor generation fencing and multiple simultaneous monitors.
The rerun [#38065672095](https://github.com/Emaren/aoe2-watcher/actions/runs/38065672095)
passed both Linux and Windows jobs. No 1.6.4 binary was published.

Before tagging stable 1.6.4, separately certify signed installer content,
protected update metadata and safe relaunch; a trusted physical Windows
pilot must exercise camera permissions, real two-POV matching, uninterrupted
recording, CPU/RAM/bandwidth, finalization and failover on a compatible
deployed Television backend. The production Watcher remains 1.6.3 until then.

## Legacy Windows v1.5.10 → 1.6.4 migration contract

The immutable `v1.5.10` release's `main.js` already integrates
`electron-updater` and the AoE2WAR `/downloads` generic updater feed.
Its `watcher-config.json` resides in Electron's userData directory—the
same application identity and path as this candidate. It contains the old
Watcher API key and replay-folder choice; migration must preserve those
settings and the replay archive. It is not safe to overwrite the user's
config or treat a new pairing as a successful in-place update.

An **installed Windows NSIS** client may upgrade through the existing
updater feed if the published `latest.yml`, signed NSIS bytes, signing
identity and old-updater behavior permit the jump. **Windows portable**
does not self-install: show the verified final NSIS installer as the
recommended clean replacement or offer the signed portable EXE for
manual substitution. Never tell portable users that quit-and-install
works. Existing version 1.5.10 has different update timing from the
hardened 1.6.4 logic; running the new 1.6.4 tests alone cannot prove
the old client safely installs a new binary.

Before public roll-out, record a **physical legacy upgrade canary**:
v1.5.10 binary channel (installed/portable), old config SHA-256,
automatic-check result, actual signed 1.6.4 payload identity, exit
and relaunch, helper teardown, final `app.getVersion()`, preserved
config equality (excluding deliberately migrated fields), replay
folder, Watcher ID and key continuity, and one Watcher replay/signature
observation accepted by the deployed backend. Redact secrets and
personal local paths from shared receipts. Fall back to manual installer
if any gate fails and never delete or reprocess old replays to force a
success indicator.

## Coordinated Television rollout and safe roll-forward

1. Reconcile the stacked Television WOLO V3 application work (tracked in
   AoE2WAR web PR #460) and the separate admin-only Zodiac RM/DM evidence
   audit (web PR #461) through the **normal protected merge and Finish**
   release lane. A green web build is not a deployed compatible API.
2. Before directing Watcher 1.6.4 to production, independently verify its
   bearer-key/SteamID provenance contract with the deployed ingest API;
   ensure the actual media directory is on the intended **mounted volume**,
   not VPS root. Measure capacity for per-POV two-hour videos and retain the
   postgame minimum. Default limits and codec targets alone do not prove a
   two-hour video can be retained.
3. Build and certify five **real release artifacts**: Windows signed and
   timestamped NSIS + portable, macOS package and direct ZIP, and Linux
   AppImage. Bind each to immutable checksums and release metadata. The
   current CI-only Windows unsigned artifacts expire after two days and must
   never be placed into the public updater feed.
4. Run a **legacy Windows v1.5.10 NSIS** canary followed by a portable
   migration canary, confirming retained userData config, API key, watcher
   identity, replay path, Steam rating receipt signature, benign helper
   teardown, and actual post-install version. The old executable must be
   tested as shipped; passing a 1.6.4 simulated update test is insufficient.
5. Conduct at least one multi-POV native Windows battle canary against the
   deployed media backend and verify first browser frame, 15-minute postgame
   protection, native viewer diagnostics, CPU/RAM/network usage and measured
   actual bytes per hour. Field acceptance remains distinct from code CI.
6. Only after those gates publish the immutable 1.6.4 assets and compatible
   `latest.yml` / website `/api/watcher/release` metadata in the correct
   order, with checksum checks from **outside** the build job.
   Never point users at a version without real downloadable assets.

If a newly published version fails after clients update, **roll forward**
to repaired 1.6.5 or use a separately verified manual installer. The
stable updater forbids downgrade; changing a feed back to 1.6.3 is not a
reliable rollback for clients already on 1.6.4. An incident response must
preserve the replay folder, pending upload identity, journal evidence, and
all matched/unmatched WOLO financial invariants.

## Five-artifact packaging parity and macOS security (2026-10-10)

The release candidate's GitHub Actions source CI now runs **four**
independent jobs. In addition to the Linux Node contracts/security gate
and native Windows NSIS+portable package job, the new **macOS arm64**
job builds an unsigned DMG and derives the exact direct ZIP from the
same macOS `.app` bundle. A separate **Linux x64** job builds the actual
AppImage. Both assert exact `1.6.4` identity, nonempty output, safe
installation instructions and SHA-256 hashes. Candidate artifacts are
retained by Actions for **two days only** and are not published to the
Watcher update channel. Unsigned packaging smoke is not proof of macOS
Developer ID, Apple notarization, Windows Authenticode or physical
replay/video capture.

The macOS direct ZIP README previously included a command to remove
Gatekeeper quarantine attributes when the app was unsigned. That
instruction has been **removed**. The manual installation guide now
requires the legitimate signed/notarized AoE2WAR release and directs
users to stop if macOS reports untrusted, damaged or unverified code;
users must not disable Gatekeeper or strip quarantine to install
Watcher. The new regression test checks that unsafe workaround
instructions do not reappear in the ZIP-builder source.

**Residual release proof:** a production Mac bundle still needs the
appropriate Developer ID signature and notarization, and its official
upgrade ZIP and `latest-mac.yml` must be produced by a reviewed
compatible electron-builder signing workflow, rather than assuming
that the separately wrapped direct ZIP is updater-compatible.
Electron-builder auto-update ZIP compatibility is a separate requirement
from the manual ZIP. Do not publish either candidate to the generic
download feed until official platform signatures, hashes, deployment,
legacy upgrade and real media decode canaries pass.

### Signed Windows artifact verification (2026-10-10)

The existing `Sign Windows Watcher` GitHub Actions workflow uses the trusted
Windows runner and Azure Artifact Signing, so the release does not require
the operator to own a Windows computer merely to produce a signed installer.
The 1.6.4 candidate tightens the **post-sign** gate: both versioned NSIS and
portable EXEs must exist at the expected filenames, exceed the minimum byte
size, have a `Valid` Authenticode chain, include both a signing certificate
and RFC3161 timestamp certificate, and produce a SHA-256 inventory from the
final **signed** bytes. Failure blocks the signed artifact upload.

Windows release signing remains on the protected workflow, never a
pull-request signing job. Unsigned CI artifacts are test-only, not public
installers. These certificate checks do **not** establish a working installed
v1.5.10→1.6.4 updater migration, video permissions, resource consumption,
or compatible server media ingestion. Those independent canaries remain
required before public promotion.

## Updater-native macOS ZIP source gate (2026-10-10)

The candidate now builds an electron-builder `zip` target **in addition to**
the separate `dmg` and README-wrapped `aoe2hdbets-watcher-direct.zip`.
Only the builder ZIP is eligible for the native macOS update channel.
`scripts/verify-mac-updater.cjs` requires one distinct versioned arm64
updater ZIP, a matching `latest-mac.yml` default path and files entry, and
byte-derived SHA-512 equality for **both** manifest digest fields. It rejects
manual ZIP substitution, missing/ambiguous payloads, wrong versions and
tampered hashes before the release workflow uploads candidates.

The macOS unsigned CI lane and non-Windows release build invoke that guard
and preserve the native ZIP. **Source/unsigned package integrity is not
developer signing, notarization or an installed update canary.** The web
production release promoter and final immutable publication inventory must
also include and verify the updater ZIP **before** updating
`latest-mac.yml` (tracked in app-prodn issue #464). Do not flip macOS
in-app automatic updates until signed/notarized payload and real installed
old-to-new upgrade receipts exist.

## Official Mac release signing/notarization gate (2026-10-10)

The **protected**, manually triggered `Build non-Windows Watcher Release`
workflow differs from unsigned pull-request CI. It requires non-empty
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` GitHub Actions secrets
at release-build time. Electron-builder signs the hardened Mac application;
the existing afterSign hook submits the app for notarization. The protected
workflow additionally notarizes and staples its DMG.

Before uploading release artifacts, `scripts/verify-mac-signed-release.sh`
enforces a valid Developer ID Application signature and matching Apple team,
Gatekeeper `Notarized Developer ID` verdict, app/DMG stapler proofs, and
the native update ZIP's matching `latest-mac.yml` SHA-512. It extracts the
native updater ZIP and separately verifies the contained app signature.
The final release bytes also get a SHA-256 inventory. Missing credentials,
notary rejection, unsigned bundles, mismatched team IDs or invalid updater
bytes **stop** the official workflow; none may be classified as a trusted
public release. Secrets must be configured in protected GitHub Actions
settings; the repository does not reveal whether they are provisioned.

Normal `Watcher CI` continues unsigned packaging smoke with no access to
production signing credentials. Even a successful protected Mac release job
does not prove installed legacy migration, native two-POV capture, or a safe
public feed flip; those remain distinct certification gates.


## Mac live-video source scan failure — October 10 field report

Observed on a real macOS Watcher 1.6.4 while a replay was being monitored: the
Video source dropdown stayed empty and the UI showed `Source scan failed.`;
the website displayed `No registered feed on this battle`. Those symptoms
place the first known failure **before** Video `/api/streams/start`; do not
interpret a live replay session as a working camera.

Source acquisition uses main-process `desktopCapturer.getSources` for window
and screen listings. The app now reports the full source-error cause alongside
the macOS `systemPreferences.getMediaAccessStatus("screen")` value. Permission
status is a diagnostic, never a fabricated proof that video can be captured.
A `granted` status with a failing provider remains a real capture failure.
An empty successful source enumeration is also reported as a failure, not a
usable source picker. These checks never pause replay monitoring or grant
capture authorization themselves.

**Field triage:** open macOS System Settings → Privacy & Security → Screen &
System Audio Recording, enable AoE2HDBets Watcher if present, fully quit/relaunch
Watcher, select **Sources**, prefer **Full Screen** for disappearing full-screen
games, preview, then **Start Video**. If still failing, capture the *exact*
readout under `Source scan failed` (the expandable diagnostic) and system
permission status. Browser Stream on the profile page is a separate user-
consented fallback; it must still prove a stream register and playback.
Do not delete/re-pair Watcher, alter replay folders or run Wolo mutations.

Release gate: Node contract tests cover granted/denied/not-determined/unknown
and platform-specific diagnostics. Source discovery, real macOS permission
switch/relaunch, frame capture, server stream registration, and public playback
still require an installed-client canary before claiming success. A GitHub PR
is source-only and does not modify the immutable released 1.6.4 artifacts.

### macOS native-picker fallback (source-only, unproven on an installed client)

The Oct 10 Mac field evidence is now stronger: screen-recording permission
was visibly enabled for the Watcher, the app was fully restarted, and the log
still recorded `Stream source scan failed: Failed to get sources.`.
Electron can reject a `desktopCapturer.getSources()` enumeration for reasons
other than user consent. Do not declare the app unpermissioned based only on
that generic Chromium error.

A manual `Start Video` click, when source enumeration has failed and
`nativeStreamState.sources` is empty, requests `getDisplayMedia({video, audio:false})`.
On macOS 15+ Electron's experimental `useSystemPicker: true` path allows
the OS to present the user-controlled screen/window picker without a successful
`getSources` result first. The handler is installed before the Watcher
window boots; on systems without the native picker the display-media request is
rejected instead of silently sharing an arbitrary first monitor. Watcher's
explicitly chosen legacy getUserMedia screen source remains separate. The fallback requires an explicit
user gesture; automatic video never initiates an OS picker.

Cancellation or denial must stop cleanly with no stream ID, replay restart,
camera upload, or public playback claim. A chosen capture follows the
unchanged `/api/streams/start`, MediaRecorder, bounded chunk, heartbeat and
terminal-stop protocol. This is a field-test candidate only and is **not**
a modification to immutable v1.6.4 release binaries.

Manual **Stream My Game** is disabled until Watcher has a replay-backed match
candidate. No capture is initiated under an unlinked synthetic game name when
the app is idle. This prevents the ambiguous cross-battle streams observed in
the October 10 field test. Restart replay monitoring and let it identify the
game before pressing the button; a matched, trusted replay still owns result
truth independently of camera video.

After building a canary, verify these milestones independently:
1. User presses **Start Video**, sees the native chooser and selects the display.
2. Local video preview contains actual game pixels and remains live on fullscreen transition.
3. A `/api/streams/start` response includes a real stream ID for the match.
4. Video chunks land, and Television WOLO binds to the same canonical battle.
5. Playback succeeds after **Play**; closing/cancelling stops video but does not
   interfere with `.aoe2record` monitoring or backlog.
6. On macOS 14 or where the system picker is absent, capture fails with an
   honest error and offers Browser Stream instead.

Upstream reference: Electron
https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts
(and the documented experimental macOS 15+ limitation).

### Runtime telemetry admission (October 11 Mac dev canary)

The installed/canary Watcher may emit local recovery events such as
`settlement-state-restored` and `replay-scan-complete`. Those **do not
belong** to the server's accepted `/api/watcher/events` vocabulary
(`lib/watcherTelemetry.ts`, certified app source `ea8055c427`).
Previously, a generic snake-case fallback sent those events anyway and
the live API rejected them with HTTP 400, creating misleading output.

`runtimeTelemetryContract.js` now gates **only generic runtime-to-remote
fallback events** against a finite approved server event vocabulary. All
original diagnostic runtime events remain in the on-device journal/UI;
explicit authenticated replay, stream, updater, auth and heartbeat
telemetry remain unchanged. A new runtime event is local-only until its
remote admission is intentionally agreed with the server and regression
tested. No replay state, capture, auth key or match-binding changes.
The source change is a separate **stacked development candidate**; it is
not an amendment to signed public v1.6.4 artifacts.

### CrossOver / Wine macOS capture-source contract (next Watcher canary)

Steam Age2HD through CrossOver/Wine may have no standalone native macOS
window recognizable as the game. A source called `CrossOver` or `Steam`
is *not proof* that selecting that window will show live game pixels.
A visible game window can also disappear when the game changes into
exclusive full screen.

Watcher therefore uses a deterministic, test-covered source policy:
- Explicitly selected capture source wins, regardless of bitrate/framerate
  mode. If it disappears or its source ID changes, stop and request a
  new selection. Never substitute another monitor silently.
- Native macOS **Full Screen** mode (the macOS initial default) chooses a
  display even if Wine momentarily exposes a game-named window. The user
  must still grant macOS capture permission, and full display capture
  includes **everything visible on the chosen monitor**.
- Other modes prefer unmistakably AoE2-named native windows over wrappers;
  on Mac, when no game window can be identified, choose the display
  fallback. A browser or Watcher window is never the default.
- On Windows, prefer a recognized game window. A deliberate Full Screen
  mode can select a display; otherwise demand an explicit selection
  instead of capturing an unrelated browser or launcher.
- When Electron cannot enumerate any source, **only a user-initiated**
  capture attempt may open the experimental macOS 15+ system picker.
  Automatic background streaming cannot summon a permission dialog
  or choose an arbitrary screen.
- Human-friendly `Display selected` and `Choose a capture source`
  labels are hints, never assertions that a playable frame, match
  registration, or viewer decoding has succeeded.

No platform uses OCR, window-title-to-battle identity, or privilege
bypasses. Match linkage stays source-backed and separate from video.
Windows native and Mac/CrossOver physical canaries are required before
promoting this branch to an immutable signed release. `1.6.4` remains
the last certified published version until the version transition follows
Release OS / vault controls. Keep streaming opt-in, preserve replay-upload
priority and never capture private windows without the user's choice.
