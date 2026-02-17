# aoe2-watcher

Electron helper that watches your AoE2 replay folder and uploads completed replay files.

## What changed

- Firebase has been removed completely.
- Uploads now go directly to `/api/replay/upload` on your configured API base.
- Uses `x-user-uid` header for identity.
- Supports `.aoe2record`, `.aoe2mpgame`, `.mgz`, `.mgx`, and `.mgl`.

## Setup

```bash
npm install
cp .env.example .env
```

Optional environment variables:

- `AOE2_API_BASE_URL` (default: `https://aoe2hdbets.com`)
- `AOE2_WATCH_DIR` (default: platform-specific AoE2HD SaveGame path)
- `WATCHER_USER_UID` (default: hostname-derived watcher id)

## Run

```bash
npm run start
```

## Build (macOS DMG)

```bash
npm run build
```
