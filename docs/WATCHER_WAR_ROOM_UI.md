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

The interface deliberately displays unavailable values for verified player wins/losses, RM/DM ELO and historical streaming totals until authoritative read-only APIs are approved.
A saved replay directory is **not** evidence of a valid replay directory. The War Room readiness label follows Old Blue's validated `folderReadyText` and `watchDirStatus.valid`, and watches that label for changes. A locally configured Watcher upload key is **not** proof of a server-verified player identity; the UI labels it as a credential, not an authenticated profile.

Monitoring status and detail mirror Old Blue's authoritative renderer state, including replay upload failures and background import phases. Green monitoring status must not mask a recent issue. The process-CPU mini-graph ingests only profiles with a valid `sampledAt` and adds at most one graph point per unique sampled timestamp: duplicate `getAppInfo` snapshots are not independent measurements. Never estimate ELO from current upload timestamps, infer a winner from persisted bytes, treat a capture as proof of viewers, or derive user identity from an unverified local filename.

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
