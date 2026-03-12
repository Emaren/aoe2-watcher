# aoe2-watcher

Electron helper that watches your AoE2 replay folder and uploads completed replay files.

## What changed

- Firebase has been removed completely.
- Uploads now go directly to `/api/replay/upload` on your configured API base.
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
- `AOE2_UPLOAD_STABLE_CHECK_PASSES` (default: `3`)
- `AOE2_UPLOAD_QUIET_PERIOD_MS` (default: `30000`)

## Run

```bash
npm run start
```

## Build (macOS DMG)

```bash
npm run build
```
