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

The canonical original Electron interface is **Old Blue (Classic)**. Immutable source-fidelity tests (normalizing only LF/CRLF checkout differences) pin the original Classic shell's SHA-256 to `831babc3ac27ae393415a73492f45a1e52d1e2f46d7a0df716912035ca07642d` and the original inline stylesheet's SHA-256 to `4c2f44247da2bd73acf14020b939f0e12c216b8c161781164a31cbf72a4af2a0`, computed from Watcher parent `2b1d2a0e3973a937c6f57bdebdace47cc1684b4f`. This guards against accidental drift during future theme additions. It remains in `index.html` with its original visual CSS, element IDs, and `renderer.js` lifecycle; the old interface is not reconstructed from a screenshot. The new **War Room** is loaded separately by `war-room.css` and `war-room.js`, after the original renderer, and chosen by a persistent top-right appearance button.

Parent: `feature/watcher-1.6.5-development`, original base SHA `2b1d2a0e3973a937c6f57bdebdace47cc1684b4f`. New UI branch: `feature/watcher-1.6.5-war-room-ui`, draft PR #42. Target this parent only; do not merge directly into `main`, release, or publish binaries without reconciling the existing 1.6.5 ancestry and passing the full release gates.

Appearance preference resides under the localStorage key `aoe2war.watcher.display-theme.v1` and is **presentation-only**. There is no duplicated replay watcher, updater, upload engine, native recorder, key store, or settlement path. Switching themes never calls `location.reload`, starts/stops monitoring, or submits network requests.

## User-facing information hierarchy

1. **Overview**: monitoring and pairing status, genuine bounded process telemetry, recent replay events, last import summary, simple broadcast status, and player-record placeholders.
2. **Battles**: session replay observations and access to the original website player profile. Replay uploads are not wins or losses.
3. **Broadcast**: mirrored source choices and capture modes; Go Live, Stop Video, Refresh Sources. These delegate exclusively to the original controls, renderer authorization, and source-selection policy. Broadcast temporarily reparents the **one original Classic video element** into its visible preview slot, then restores it to its exact original DOM position when the player leaves. The existing renderer remains sole owner of `srcObject` and recording; there is no duplicate decoding surface or second MediaRecorder.
4. **Systems**: restrained diagnostics with one-click access to the untouched original setup and support details.

The interface deliberately displays unavailable values for verified player wins/losses, RM/DM ELO and historical streaming totals until authoritative read-only APIs are approved.
A saved replay directory is **not** evidence of a valid replay directory. The War Room readiness label follows the original renderer's latest `folderReadyText`, which is updated by its asynchronously validated replay-directory check and protected against out-of-order validation responses. A one-time native `watchDirStatus.valid` snapshot is used only before Classic's validated label becomes available. Once Classic has reported its current result, a stale app-info snapshot cannot freeze an invalid-to-valid recovery or override a later valid-to-invalid result. Switching configured replay paths immediately resets War Room readiness until Classic validates the selected folder again. A locally configured Watcher upload key is **not** proof of a server-verified player identity; the UI labels it as a credential, not an authenticated profile.

Monitoring status and detail mirror Old Blue's authoritative renderer state, including replay upload failures and background import phases. The command-post headline changes between setup required, monitoring active, attention needed, and ready, based on existing validated evidence rather than a fixed success message. Green monitoring status must not mask a recent issue. The process-CPU mini-graph ingests only profiles with a valid `sampledAt` and adds at most one graph point per unique sampled timestamp: duplicate `getAppInfo` snapshots are not independent measurements. Older out-of-order sample epochs are also discarded before updating CPU, memory, network or wakeups; their arrival cannot rewind live telemetry. The dynamic test harness sends deliberately older CPU/RAM observations after newer ones to assert that neither the chart nor readouts regress. Never estimate ELO from current upload timestamps, infer a winner from persisted bytes, treat a capture as proof of viewers, or derive user identity from an unverified local filename.

## Future trusted profile feed — separate, independently reviewed work

The paired client must retrieve an authenticated, owner-scoped summary through a service explicitly designed for this purpose; **do not** pass `uploadApiKey` to arbitrary URL/website routes or introduce any browser token forwarding. No changes to application or API production repositories are authorized in this branch.

Candidate narrow response fields after separate server design/review: `player` (canonical display name, public/avatar URL only), `verifiedRecord` (resolved wins, losses, unclassified count and source effective-as-of), `ratings` (separate RM/DM dated, provenance-qualified values), `recentMatches` (bounded adjudicated outcomes), and `streaming` (durable sessions, airtime, separately verified peak concurrent audience). Include explicit `unknown`/no-data and stale-state handling and safe caching, never manufacture zeros for missing evidence. The server remains sole authority for historical result and financial disposition.

## Observed player-data API inventory (read-only inspection, October 19)

The existing app has rich server-side player projections in `lib/playerProfile.ts`, including adjudicated match outcomes, Steam RM/DM ratings, Watcher statistics and stream summaries. These are not, by themselves, a safe Watcher endpoint.

- `app/api/user/watcher-key/route.ts` lists/mints key prefixes under a **browser session**. It does not return a Watcher-client profile summary.
- `lib/watcherTelemetry.ts` has `resolveWatcherTelemetryIdentity`, which validates hashed, unrevoked `kind=watcher` credentials against canonical users; `readWatcherTelemetryApiKey` reads `x-api-key`. This is a useful existing identity authority, but an attempted key is not identity until the server confirms `resolved=true`.
- `lib/streamRequestAuth.ts` already resolves a `watcher_key` actor for the **stream** service. It should be referenced for consistency without granting any stream mutation capability to a statistics reader.
- `app/api/player-profile/matches/route.ts` accepts client-supplied `kind=claimed&uid=...` or replay name and returns a public page of matches. It **does not cryptographically bind that query to the Watcher key owner**. The desktop must not guess or trust its own submitted UID/name to claim this is the current player's record.

**Conclusion:** an authenticated, owner-scoped, *read-only* profile-summary operation is still missing from the audited public `main` route inventory. Do not fetch those values anonymously and relabel them as paired-user facts. Other application branches are out of scope and may independently evolve.

### Proposed separately reviewed integration contract

1. An application-side `GET /api/watcher/player-summary` (proposed route name, **not implemented** here) validates `x-api-key` using the existing hashed/unrevoked watcher identity resolver, requires `resolved=true`, and derives all user identity from the server-side key-to-user relationship. It ignores client-supplied `uid`, `name`, wallet or Steam identifier selectors. No settlement or financial mutations.
2. The response is strictly bounded and provenance-qualified: `schemaVersion`, `generatedAt`, canonical public `displayName` and optional approved avatar, effective RM/DM ratings with their own `asOf` and authority, decided `wins`/`losses` plus `unresolved`, a small `recentMatches` list with effective winner adjudications, and streaming session count/airtime. Unknown metrics must be nullable/explicitly unavailable, especially viewer counts. Never count unproven uploads as wins or a capture-start as public viewers.
3. The desktop main process, not arbitrary renderer `fetch`, can later request the summary from a pinned first-party HTTPS origin with the Watcher key in the expected header. Reject redirects to untrusted origins, avoid query-string keys, and never send that key to a user-configured fallback or third-party URL.
4. Add a minimal `watcher:get-player-summary` read-only IPC method only in a **separate approved integration PR**, with key-scoped cache invalidation after re-pairing/revocation, bounded TTL (e.g. 60s), cancellation/single-flight, explicit offline/401/403/stale states and no extra background polling. Do not hold the full key in a renderer graph or diagnostic log.
5. Acceptance: two disjoint accounts + one revoked key must demonstrate owner isolation, correct RM/DM chronology, replay result finality, absent-metric states and absence of financial writes. A response from a public `kind=claimed` selector does not pass this gate.

Until that independently reviewed server and main-process contract exists, the War Room presents honest unavailable states and sends users to the existing public website profile.

## Verified player summary display adapter (UI-only, no authenticated endpoint yet)

War Room now packages `war-room-player.js`, a pure, read-only presentation contract. The `war-room.js` renderer subscribes to **optional** `watcherApi.onPlayerSummary` only when that explicitly approved preload method exists. It does **not** add that method to today's preload, make any HTTP request, forward keys, or initiate a watcher-summary fetch. Consequently every actual public build still shows unpopulated verified player statistics until the separately governed main-process/server integration is approved.

The proposed version-1 payload for that future **owner-authenticated IPC** is:

```json
{
  "schemaVersion": 1,
  "status": "verified",
  "generatedAt": "2026-10-19T17:00:00Z",
  "player": { "displayName": "Server-authoritative name" },
  "record": { "wins": 0, "losses": 0, "unresolved": 0 },
  "ratings": {
    "rm": { "value": 1200, "authority": "steam", "asOf": "2026-10-19T16:00:00Z" },
    "dm": null
  },
  "recentMatches": [
    { "opponent": "Opponent", "map": "Arabia", "mode": "rm", "result": "unresolved",
      "playedAt": "2026-10-19T16:00:00Z" }
  ],
  "streaming": { "sessions": null, "airtimeSeconds": null, "peakConcurrentViewers": null }
}
```

This is a **schema example, not an actual player result or a live HTTP response**. Only a reviewer-approved first-party main-process IPC backed by server-verified Watcher-key ownership may publish it. A client-supplied `status: "verified"` flag by itself does not prove identity or authenticity.

The adapter fails closed for unsupported versions, stale or future-dated generation times (10-minute maximum age), malformed records, missing ratings, unauthenticated states and absent viewer counts. Timestamps must contain an explicit timezone and describe a real calendar date. Future-dated rating/match evidence beyond one minute of the response's generation time is rejected. A trusted profile response schedules exactly one one-shot expiry (no polling, no network), cancels it on refresh or credential change, and clears displayed data when it expires. Stale callbacks from superseded timers cannot clear newer profile data. Win rate uses decided wins/(wins+losses) only; unresolved outcomes remain separately counted. RM and DM ratings stay separate and require an authority and rating timestamp. At most five adjudicated battle observations are rendered, with neutral unresolved markers. Lifetime streams, airtime and viewer metrics remain dashes when not server-proven. Overview and Broadcast take lifetime streaming totals from the same validated summary; there is no independent fake counter. All received names and match details enter the DOM through `textContent`, not HTML interpolation. The win-rate ring uses lightweight CSS, not a chart framework.

Any Watcher configuration update clears the displayed verified player data immediately, preventing a previous account's records from persisting through a credential change. Future main-process integration must also fence in-flight responses from superseded credentials and handle revoked or switched accounts. Rendering is passive and does not add a periodic refresh or an IPC call when today's preload lacks the authorized method.

Dedicated pure-contract tests: `tests/war-room-player.test.js`. The simulated Electron DOM tests in `tests/war-room-runtime.test.js` cover a verified → unauthorized transition and credential reset. These do not replace a two-account server authorization test or a full native Electron run.

## Non-negotiable boundaries

- No change to `Emaren/app-prodn`, `Emaren/api-prodn`, `Emaren/wolochain`, Auto Bets, War Satchel, financial custody, signer keys, settlement or chain state.
- No new polling timers or network calls for UI decoration. Systems can display actual existing per-process network attempt Mbps and processor wakeups per second only when a valid sampled observation exists. These are activity indicators, not verified end-to-end delivery metrics or watt measurements. Local CPU graph is capped at 40 actual samples, consumes the already emitted existing resource events, and does not calculate watts.
- No new recorder, duplicate decoding video, automatic capture-source escalation, or stream reauthorization triggered by an appearance change. CrossOver/Steam wrapper safety rules and explicit source selection remain owned by the original Watcher.
- Do not modify or re-label signed public v1.6.4 installer, portable, DMG/ZIP, or Linux assets. Package version remains `1.6.4` until certified v1.6.5 promotion.

## Simulated-renderer lifecycle regression suite

`tests/war-room-runtime.test.js` now executes the **actual `war-room.js` script**, under Node's built-in `vm` with a minimal in-memory DOM implementation. This is a deterministic renderer-state test, not a real OS capture or complete Chromium integration. It verifies (1) appearance selection and preference persistence without a second monitoring action, (2) Watcher status and replay-import projection, (3) restoration of the **same** video element during Old Blue/Broadcast changes, (4) disabled original control forwarding, (5) timestamp-deduplicated CPU graphs, (6) no invented stream start if launching midstream, (7) original capture-source authority and rejection of unknown sources, (8) original capture-quality authority, and (9) correct issue/error presentation.

Because the harness is dependency-free, `node runTests.js` automatically runs it with the existing Node test discovery on Windows, macOS and Linux. The structural-source checks remain in `tests/war-room-ui.test.js`. **Neither suite proves real browser layout, GPU usage, stream continuity on CrossOver, or privacy-safe source choice on a user's actual machine.** The physical canary remains mandatory.

## Operator acceptance procedure — physical macOS / CrossOver (not yet executed)

**Preconditions:** Use a locally reviewed non-production build from the exact CI-qualified UI commit and the existing 1.6.5 development ancestry; do not install/promote any public release or change live production. Close the ordinary Watcher before launching a separate test instance: **never run two Watcher processes with the same replay folder, paired key or stream identity**. Record the test build's commit and binary fingerprint. Verify that any real video stream uses an explicitly approved test source and that the user is willing to make that content visible; do not publish a private desktop incidentally.

**Evidence record** (one small local QA receipt, not secrets): date, macOS version, machine architecture, CrossOver/game launch mode, exact Watcher Git SHA, test build artifact hash, known source/window label, test time, outcome for each checkpoint, sanitized screenshots of each theme and stream state, CPU/RAM peak/average, and any failure text. Never include Watcher keys, wallet secrets, participant contact info, token balances, or full file paths in screenshots or uploaded diagnostics.

**Checkpoint A — Old Blue preservation.** Open the test build, select the top-right Old Blue icon and compare against the known 1.6.4 visual controls. Verify replay folder, pairing, Watch/Stop, capture-source selection, quality modes, import, update and support controls. Toggle away and back ten times; all fields and current monitoring state must survive, with the original video element returned to its exact parent. Restart once and confirm the selected theme persists. Evidence: before/after screenshots with sensitive values redacted.

**Checkpoint B — passive monitoring.** With one test Watcher process, monitor a test replay while repeatedly switching between Old Blue/War Room and tabs. Confirm exactly one replay detection, no duplicate uploads, no import queue reset, and no spurious video capture. Verify valid/missing replay folder and missing/revoked credential states do not falsely display green. Stop watching and check both views show the same state.

**Checkpoint C — explicitly authorized game stream.** Within the Watcher UI, choose and independently verify the intended CrossOver/AoE2 HD game window. If fallback to a display is required, deliberately select the correct screen and verify its contents before broadcasting; **never auto-escalate to the full display**. Begin a test stream using the original engine, check independent viewer playback, and switch Old Blue ↔ War Room ten times during live video. Confirm same native source, MediaRecorder lifecycle, stream ID/sequence continuity, Stop action and original video element identity. Check no second encoder/decoder, no unexpected CPU/GPU surge and no revealing of non-game windows or desktop notifications. Stop from War Room, then from Old Blue on a second session.

**Checkpoint D — resilience and reduced resources.** Try idle/no-replay, no-source-selected, source-window disappears, upload endpoint temporarily unavailable (only if safely emulated), historical import in progress, and theme switch during an active update check. Confirm the UI does not promise success when capture/upload fails. Confirm process telemetry stays within a reasonable recorded baseline relative to Old Blue; no fixed thresholds or made-up power savings are assumed. Check keyboard Tab, arrows, Home/End and focus states, plus a narrow window and a typical desktop viewport.

**Decision:** Every mandatory checkpoint must be PASS with a real-world evidence receipt before UI merge or publication. A simulator or CI artifact is not a substitute for the actual capture/privacy canary. A failure requires an issue with reproduction steps and a dedicated fix; **do not** bypass by turning off protective validation.

## Acceptance checklist before merge/promotion

- Run `npm run lint`, `npm test` and packaged Windows NSIS/portable, macOS ARM DMG/direct ZIP, Linux x64 AppImage in the existing Watcher CI.
- macOS CrossOver manual canary: start monitoring; choose Full Screen and explicit display; start stream on identified game; toggle Old Blue ↔ War Room at least 10 times; confirm exact preview video-node identity and original DOM restoration, no parallel video decoder/MediaRecorder, original display/session persist, no secondary publisher, no accidental screen disclosure, independently viewable video, and Stop still works.
- Test switching while replay upload, historical import, and updater checks run. No queue loss, server drift, or duplicate upload.
- Test picker and tablist keyboard access (Tab, Enter, Left/Right/Home/End, visible focus) and 740px / 1180px responsive layouts. Test missing folder/key, no players, absent resource metrics, and stale data.
- Confirm no Watcher CLI, producer, signing, web deployment, Wolo/Auto Bet/Satchel files changed.
- Distinguish earlier passing commit CI from latest-head CI: a success from a superseded commit does not certify the next commit. Treat queued or missing latest-head CI as **not passed**. Draft PR #42 must stay nonrelease until all required proof and separate 1.6.5 ancestry review are satisfied.

## Latest evidence, October 19

The source branch and draft PR exist; version remains 1.6.4. Earlier four-job CI on `9c421260` passed (test plus Windows, macOS and Linux packaging smoke), while later UI commits remain **unverified by latest-head CI** as of the last check. The dedicated source-contract suite was independently evaluated with a Node-test-compatible shim, which does **not** substitute for the full repository test runner, Electron integration, or physical CrossOver capture validation. No public 1.6.5 release is claimed.
