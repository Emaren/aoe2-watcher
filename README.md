# aoe2-watcher

Electron helper that watches your AoE2 replay folder, emits live replay snapshots while a match is in progress, and uploads the final replay when the file settles.

## What changed

- Firebase has been removed completely.
- Uploads now go directly to `/api/replay/upload` on your configured API base.
- Live watcher uploads now mark non-final replay iterations so `/live-games` can light up before the match ends.
- Uses `x-user-uid` header for identity.
- Optional `x-api-key` support via `AOE2_UPLOAD_API_KEY`.
- Supports `.aoe2record`, `.aoe2mpgame`, `.mgz`, `.mgx`, and `.mgl`.
- Retries transient parse/upload failures automatically and skips duplicate re-uploads for the same finished replay.

## Setup

```bash
npm install
cp .env.example .env
```

`npm run start` loads `.env` automatically.

Optional environment variables:

- `AOE2_API_BASE_URL` (default: `https://api-prodn.aoe2hdbets.com`)
- `AOE2_WATCH_DIR` (default: platform-specific AoE2HD SaveGame path)
- `WATCHER_USER_UID` (default: hostname-derived watcher id)
- `AOE2_UPLOAD_API_KEY` (set this if backend `INTERNAL_API_KEY` is enabled)
- `AOE2_UPLOAD_RETRY_ATTEMPTS` (default: `4`)
- `AOE2_UPLOAD_RETRY_BASE_DELAY_MS` (default: `4000`)
- `AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS` (default: `3000`)
- `AOE2_UPLOAD_QUIET_PERIOD_MS` (default: `30000`)
- `AOE2_INITIAL_LIVE_DELAY_MS` (default: `3000`)
- `AOE2_INITIAL_LIVE_RETRY_COOLDOWN_MS` (default: `10000`)
- `AOE2_LIVE_UPLOAD_COOLDOWN_MS` (default: `45000`)

## Run

```bash
npm run start
```

## Build (macOS DMG)

```bash
npm run build
```
