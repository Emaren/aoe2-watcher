---
id: "aoe2war.aoe2-watcher.docs-watcher-war-room-ui"
title: "Watcher War Room Appearance and Safety Contract"
type: "working"
status: "active"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher"]
audience: ["developers", "operators", "ai-agents"]
source_of_truth: "git"
authority: "watcher-presentation-only"
reviewed_at: "2026-10-19"
review_interval_days: 30
sensitivity: "internal"
---

# War Room / Old Blue — source-only v1.6.5 work

## Scope and provenance

The canonical original Electron interface is **Old Blue (Classic)**. It remains in `index.html` with its original visual CSS, element IDs, and `renderer.js` lifecycle; the old interface is not reconstructed from a screenshot. The new **War Room** is loaded separately by `war-room.css` and `war-room.js`, after the original renderer, and chosen by a persistent top-right appearance button.

Parent: `feature/watcher-1.6.5-development`, original base SHA `2b1d2a0e3973a937c6f57bdebdace47cc1684b4f`. New UI branch: `feature/watcher-1.6.5-war-room-ui`, draft PR #42. Target this parent only; do not merge directly into `main`, release, or publish binaries without reconciling the existing 1.6.5 ancestry and passing the full release gates.

Appearance preference resides under the localStorage key `aoe2war.watcher.display-theme.v1` and is **presentation-only**. There is no duplicated replay watcher, updater, upload engine, native recorder, key store, or settlement path. Switching themes never calls `location.reload`, starts/stops monitoring, or submits network requests.

## User-facing information hierarchy

1. **Overview**: monitoring and pairing status, genuine bounded process telemetry, recent replay events, last import summary, simple broadcast status, and player-record placeholders.
2. **Battles**: session replay observations and access to the original website player profile. Replay uploads are not wins or losses.
3. **Broadcast**: mirrored source choices and capture modes; Go Live, Stop Video, Refresh Sources. These delegate exclusively to the original controls, renderer authorization, and source-selection policy. Broadcast temporarily reparents the **one original Classic video element** into its visible preview slot, then restores it to its exact original DOM position when the player leaves. The existing renderer remains sole owner of `srcObject` and recording; there is no duplicate decoding surface or second MediaRecorder.
4. **Systems**: restrained diagnostics with one-click access to the untouched original setup and support details.

The interface deliberately displays unavailable values for verified player wins/losses, RM/DM ELO and historical streaming totals until authoritative read-only APIs are approved. Never estimate ELO from current upload timestamps, infer a winner from persisted bytes, treat a capture as proof of viewers, or derive user identity from an unverified local filename.

## Future trusted profile feed — separate, independently reviewed work

The paired client must retrieve an authenticated, owner-scoped summary through a service explicitly designed for this purpose; **do not** pass `uploadApiKey` to arbitrary URL/website routes or introduce any browser token forwarding. No changes to application or API production repositories are authorized in this branch.

Candidate narrow response fields after separate server design/review: `player` (canonical display name, public/avatar URL only), `verifiedRecord` (resolved wins, losses, unclassified count and source effective-as-of), `ratings` (separate RM/DM dated, provenance-qualified values), `recentMatches` (bounded adjudicated outcomes), and `streaming` (durable sessions, airtime, separately verified peak concurrent audience). Include explicit `unknown`/no-data and stale-state handling and safe caching, never manufacture zeros for missing evidence. The server remains sole authority for historical result and financial disposition.

## Non-negotiable boundaries

- No change to `Emaren/app-prodn`, `Emaren/api-prodn`, `Emaren/wolochain`, Auto Bets, War Satchel, financial custody, signer keys, settlement or chain state.
- No new polling timers or network calls for UI decoration. Local CPU graph is capped at 40 actual samples, consumes the already emitted existing resource events, and does not calculate watts.
- No new recorder, duplicate decoding video, automatic capture-source escalation, or stream reauthorization triggered by an appearance change. CrossOver/Steam wrapper safety rules and explicit source selection remain owned by the original Watcher.
- Do not modify or re-label signed public v1.6.4 installer, portable, DMG/ZIP, or Linux assets. Package version remains `1.6.4` until certified v1.6.5 promotion.

## Acceptance checklist before merge/promotion

- Run `npm run lint`, `npm test` and packaged Windows NSIS/portable, macOS ARM DMG/direct ZIP, Linux x64 AppImage in the existing Watcher CI.
- macOS CrossOver manual canary: start monitoring; choose Full Screen and explicit display; start stream on identified game; toggle Old Blue ↔ War Room at least 10 times; confirm exact preview video-node identity and original DOM restoration, no parallel video decoder/MediaRecorder, original display/session persist, no secondary publisher, no accidental screen disclosure, independently viewable video, and Stop still works.
- Test switching while replay upload, historical import, and updater checks run. No queue loss, server drift, or duplicate upload.
- Test picker and tablist keyboard access (Tab, Enter, Left/Right/Home/End, visible focus) and 740px / 1180px responsive layouts. Test missing folder/key, no players, absent resource metrics, and stale data.
- Confirm no Watcher CLI, producer, signing, web deployment, Wolo/Auto Bet/Satchel files changed.
- Distinguish earlier passing commit CI from latest-head CI: a success from a superseded commit does not certify the next commit. Treat queued or missing latest-head CI as **not passed**. Draft PR #42 must stay nonrelease until all required proof and separate 1.6.5 ancestry review are satisfied.

## Latest evidence, October 19

The source branch and draft PR exist; version remains 1.6.4. Earlier four-job CI on `9c421260` passed (test plus Windows, macOS and Linux packaging smoke), while later UI commits remain **unverified by latest-head CI** as of the last check. The dedicated source-contract suite was independently evaluated with a Node-test-compatible shim, which does **not** substitute for the full repository test runner, Electron integration, or physical CrossOver capture validation. No public 1.6.5 release is claimed.
