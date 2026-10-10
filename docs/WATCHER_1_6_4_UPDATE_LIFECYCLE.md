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
reviewed_at: "2026-10-09"
review_interval_days: 30
sensitivity: "internal"
---

# Watcher 1.6.4 Update Lifecycle Development

This work continues `feature/watcher-1.6.4-auto-television` from
`a54e9935b05b2cb5ec7988523e3303819c9171e2`. It preserves the existing
auto-Television implementation. No release, tag, publication or deployment is
authorized by this document. Package and lock version remain 1.6.3; changing
runtime behavior on a development branch does not certify version 1.6.4.

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

## October 9: privacy-first automatic source admission

The development-only branch `feature/watcher-1.6.4-tv-source-safety-20261009`
introduces `televisionCapturePolicy.js`, a small dependency-free pure module
consumed by both Electron main and the unprivileged renderer. It is explicitly
listed in the electron-builder packaged-file allowlist for NSIS, Windows
portable, macOS DMG and Linux AppImage and checked by `npm run lint`.

When a new replay event requests **automatic** Television WOLO capture:

- The renderer obtains a *fresh* source listing; an old user selection is
  never sufficient.
- Only an explicit AoE2 HD **game window** with a valid `window:` capture
  identity can be selected. A screen, browser, AoE2WAR page, Discord/OBS
  control room, Steam launcher or a generic desktop/window fails closed.
  Familiar Windows HD names include `Age of Empires II HD`,
  `Age2HD.exe`, `AoK HD.exe` and `AoE2 HD`.
- When a safe game window cannot be determined, **no capture request or
  video-session creation occurs**. Local status explains the limitation and
  existing authenticated `stream_error` telemetry emits reason
  `auto_capture_no_verified_game_window`. Its source-count values are
  bounded and do not authorize ingestion, winning results, financial activity
  or a remote screen-sharing session.
- The manually initiated screen/window capture pathway remains available,
  including for exclusive fullscreen Windows titles where the game window is
  not independently capturable. Manual screen capture is an explicit act;
  automatic opt-in never expands it to untrusted desktop pixels.
- Permission diagnostics distinguish Windows from macOS, and the next
  replay-detection event can retry admission without repeatedly capturing
  inappropriate windows.

This is a source implementation and pure-policy regression pass, **not**
a Windows installer test or proof that every fullscreen game is detectable.
Source titles are only heuristic evidence; future packaged canaries must
verify actual Windows desktop-capture identity and activity. Source
admission does not prove battle identity, teams or game finality.

A separate bounded recovery seam prevents one broken video recording from
poisoning later matches: an opted-in auto-stream that entered `error` stays
diagnosable during its game, but authoritative
`match_result_ready` or `match_observation_complete` stops and re-arms
capture to `idle` for the **next** detected game. No idle time or file
quietness is treated as match completion. This is not an unbounded
mid-game retry, and a server media-shed still ends current video immediately.


Operator priorities for subsequent passes: correlated capture start/stop
receipts, bounded CPU/memory/encode telemetry, upload and viewer quality
metrics, long-match admission/storage ceilings, and consent-based diagnostics.
Automatic remote control or recording of unrelated desktop activity is not
part of this policy. Video may shed under pressure; replay upload retains
priority and must not block or change competitive authority.

## October 9: terminal media transport coordination

Development branch: `feature/watcher-1.6.4-stream-terminal-control-20261009`,
stacked on the safe automatic-source PR. Companion site branch:
`feature/television-v1-terminal-stream-contract-20261009`.

An authenticated chunk upload can now receive explicit video-only terminal
signals from the web application: `STREAM_STORAGE_LIMIT` (413),
`STREAM_ALREADY_ENDED` (409), the preexisting `STREAM_MEDIA_SHED`
(409), or the normal `finality: replay_final` response. The main process
normalizes these codes before the renderer's ordinary chunk retry logic.
On receipt, video capture stops without canceling the replay monitor;
the renderer reports actionable readout and a bounded authenticated event.

For opted-in capture, terminal media-shed/quota/ended responses record a
suppression key for the **current detected match**, so duplicate
`replay-detected` notifications cannot open repeated rejected video streams.
The key is cleared by existing authoritative final-observation/stop events,
not by a timeout or an assumed winner. This is intentionally fail-closed:
players may need to start a separate manual stream if automatic capture
cannot identify a game window or exhausted quota.

Never represent these code-level tests as evidence that Windows NSIS capture,
a two-user broadcast, replay-to-video session matching, multi-view playback,
multi-hour storage, or auto-updater activation have been packaged and canaried.
No installed users, source versions, release artifacts, production
recordings or Wolo accounts are modified by this development-only pass.
