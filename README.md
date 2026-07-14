# aoe2-watcher

## v1.5.4 reliability contract

Connection and replay monitoring are independent states. A heartbeat proves connection only. v1.5.4 heartbeats additionally report monitor attachment, HD-folder validity/classification, recent folder activity, current replay basename/size/change time, replay detection/upload state, queue depth, batch state, stream state, version, platform, watcher ID, and session ID. Full filesystem paths and replay contents are not sent as telemetry.

On launch, saved identity, folder, and auto-start preference are restored. The app verifies that the folder is readable and resembles an AoE2 HD SaveGame directory, attaches Chokidar, emits explicit start/ready events, and scans recent files twice for growth evidence. This recovers a game already underway without treating an old archive as live. Windows detection checks normal, OneDrive consumer/commercial, and profile Documents roots and never silently selects AoE2 DE.

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
