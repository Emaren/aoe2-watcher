# aoe2-watcher

Electron helper that watches your AoE2 replay folder, emits live replay snapshots while a match is in progress, and uploads the final replay when the file settles.

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
- skips duplicate re-uploads for the same finished replay
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

That mints a fresh watcher key on `https://aoe2hdbets.com/profile?watcher_pair=1`, saves it to the
local app config, and auto-starts when the replay folder is already known. If macOS blocks the
custom URL, use **Mint Key Only** on `/profile` and paste the fallback key into the app once.

## Optional environment variables

- `AOE2_API_BASE_URL` (default: `https://api-prodn.aoe2hdbets.com`)
- `AOE2_WATCH_DIR` (default: platform-specific AoE2HD SaveGame path)
- `WATCHER_USER_UID` (default: hostname-derived watcher id)
- `AOE2_UPLOAD_API_KEY` (optional manual fallback; one-click pairing normally fills this in)
- `AOE2_UPLOAD_RETRY_ATTEMPTS` (default: `4`)
- `AOE2_UPLOAD_RETRY_BASE_DELAY_MS` (default: `4000`)
- `AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS` (default: `3000`)
- `AOE2_UPLOAD_QUIET_PERIOD_MS` (default: `30000`)
- `AOE2_INITIAL_LIVE_DELAY_MS` (default: `3000`)
- `AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS` (default: `10000`)
- `AOE2_LIVE_UPLOAD_COOLDOWN_MS` (default: `45000`)

## Optional env example

```bash
AOE2_API_BASE_URL=https://api-prodn.aoe2hdbets.com
# optional if backend protection is enabled
AOE2_UPLOAD_API_KEY=your_key_here
```

## Current behavior notes

A normal successful session can look like this:

1. replay file appears
2. watcher emits one or more live uploads while the file is still growing
3. backend may store non-final/live state first
4. watcher waits for file quiet/stability
5. watcher sends final replay upload
6. backend stores final parsed replay

This means multiple live iterations in logs are not automatically a bug.

## Logging notes

Current watcher logs are intentionally useful while building. Expect to see messages about:

- file growth / quiet-period waiting
- live iteration numbers
- final replay upload attempts
- transient retry behavior
- minimum parseable-size thresholds

That noise is acceptable during active development because it makes replay timing issues much easier to understand.

## Build (macOS release)

```bash
npm run dist:release
```

`npm run dist:release` builds:

- the signed-state-pending DMG
- a Direct ZIP that contains the same `AoE2HD Watcher.app` bundle as the DMG

The Direct ZIP is the legitimate fallback while Apple signing and notarization are offline. It is
not a reduced feature path.
