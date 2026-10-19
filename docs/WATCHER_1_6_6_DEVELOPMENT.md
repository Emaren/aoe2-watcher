---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-development"
title: "Watcher 1.6.6 Development — Authenticated Player Companion and Independent Evidence"
type: "working"
status: "active"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher", "app-prodn", "api-prodn", "wolochain"]
audience: ["developers", "operators", "ai-agents"]
source_of_truth: "git"
authority: "watcher-1.6.6-development-contract"
reviewed_at: "2026-10-19"
review_interval_days: 14
sensitivity: "internal"
---

# Watcher 1.6.6 Development — Authenticated Player Companion and Independent Evidence

**Status: PLANNED / DEVELOPMENT ONLY — NOT IN PRODUCTION.**

**Branch:** `feature/watcher-1.6.6-development` in `Emaren/aoe2-watcher`. Created from published Watcher v1.6.5 repository `main` at `068de12018143044bc745684fe36b8a028f51387`; this is a development base, not a new distribution tag. Keep `package.json` at **1.6.5** until a separately certified version-bump/release campaign. Do not modify v1.6.5 release assets, GitHub tag, or its site download vault.

**Production policy carried forward:** Windows installer/portable remain Azure-signed and timestamped; macOS DMG/manual ZIP remain **unsigned and not notarized** (no Apple Developer subscription until the owner explicitly approves an expense when project revenue supports it); Linux AppImage remains unsigned. Preserve original **Old Blue**, existing Watcher recorder, replay uploads, update/rollback safety, Windows users, and EN/FR local toggle.

## Release baseline — what is real, what is not

- **Watcher v1.6.5:** official release already published at `https://github.com/Emaren/aoe2-watcher/releases/tag/v1.6.5`; bilingual War Room (EN/FR), Old Blue, source-selection capture consent, neutral avatar placeholder and **War Satchel / Auto Bets — financial activation pending** read-only tile.
- **Website download vault:** twelve certified v1.6.5 files promoted with `PROMOTED`, all `MATCH`, and immutable receipt `2bcbca4147e6a8f787bce674120a436cec1fd9fc9045bf0ce0928dd4f9ea918f`. This does not imply the website's Next.js production build has activated the new download page.
- **Website player profile language/avatar:** *not yet wired to Watcher.* The website project has a read-only endpoint proposal at `Emaren/app-prodn#707`. A local FR OS preference or explicit EN/FR toggle works now. Never claim Tekki's website profile setting is auto-synced before authenticated transport ships.
- **Financial integration:** WoloChain `codex/satchel-production-backend` is **financial HOLD**. Its merged witness verification contract (PR #53, integration `0064ddcb53c9400df69a8d92a96b6ec3da61e1aa`) **does not provision** an independent witness key, trusted replay-digest reader, funded vault, or production signing service. Wager execution and withdrawals remain prohibited by Watcher development work.

## Proposed 1.6.6 scope — separate authority lanes

### A. Authenticated website profile bridge (first shipping candidate)

Implement after independent review of the new website read-only endpoint:
1. Desktop **main process**, not renderer, uses the existing paired Watcher key over HTTPS to request only the canonical key owner's bounded profile. No caller-supplied UID/name/SteamID or cross-account selector; never expose key contents in renderer logs, local UI, or remote images.
2. Validated read-only versioned `onPlayerSummary` IPC carries `displayName`, `language` (en/fr), allowlisted public avatar URL, `generatedAt`, expiry, and optional independently proven stats. Fail closed on missing, stale, revoked, unpaired, cross-account or malformed data.
3. Language precedence: manual persistent EN/FR override → **verified** website profile setting → macOS/Windows OS language → English. Clear any previous player's avatar, statistics, or language association when a key or owner changes. Never infer locale from a player's nationality or a partial username.
4. Avatar fetch only from trusted first-party public HTTPS origins, no private tokens or app credentials in URL and no extra polling; a fallback neutral icon stays available.
5. Test user-switch, key revoke/re-pair, server unavailable, first-party image failure, English/French switching, and source cold-start without data leakage.

### B. Read-only War Satchel / Auto Bets status, not a wallet

- If the website later exposes an owner-authenticated **read-only** financial **availability/status** model, show clearly distinguished `NOT ACTIVATED`, `PAUSED`, `AVAILABLE` as **server-sourced** states. Never invent WOLO balances, funds, won bets, or imply financial readiness from a link/button.
- No Keplr private keys in Watcher; no betting mandate creation, signer, Satchel custody, auto-wager posting, withdrawal, escrow, or ledger mutation in the desktop. Profile links are navigational only.
- Keep feature default inactive while the independent Satchel reviewer, 8095 reviewer, 8094 signer, bank solvency, consent/revocation, and lifecycle testing remain incomplete. Project HOLD outranks cosmetic Watcher status.

### C. Independently authenticated Watcher game evidence — research/integration, not self-certification

The WoloChain independent verifier already models a short-lived Ed25519 observation:
`aoe2war/satchel/independent-watcher-witness/v1` in `internal/satchelservice/reviewer_watcher_witness.go`.
Binding includes operation ID, owner UID, Steam identity, game identity, market ID, selected side, proposition hash, linked session, source parse iteration/roster hash/roster-lock time, execution time, **raw replay SHA-256**, observation time and expiry (maximum **60 seconds**). Existing held reviewer tests reject mismatched owner, market, sides, roster, time, digest, forged key and expired receipts.

**Critical trust rule:** This contract verifies a signature **only when** an independently governed, source-pinned witness signer is provisioned *outside* the ordinary downloadable Watcher, with an independently trusted raw-replay reader and pinned key. A user-controlled desktop app **cannot** attest its own game as independent merely by signing local evidence. Do not embed a witness private key in an Electron build or turn `watcher_status=verified` into spending authorization.

1. First document Watcher capture/replay provenance with the real raw replay bytes and server-derived game/roster identity. Do not derive winners from upload success, pending parsing, or a forged Watcher IPC event.
2. Design **read-only evidence producer/transport** and independent witness trust-root lifecycle with reviewer team (WoloChain PR #53). Explicitly document external data authority, timestamp source, nonce/replay handling, digest calculation, key rotation/revocation, and availability policy.
3. Until independent implementation is independently tested, Watcher displays `Evidence not independently authenticated` and the reviewer refuses execution. Zero financial side effects.
4. Attack tests: cross-owner/re-pair, stale/duplicate game, forged roster, wrong Steam ID, changing market/selection, reordered parse iteration, raw replay digest mismatch, clock drift, expired/replayed receipt, missing external key and malicious local desktop process.

### D. Efficiency and native experience

- Preserve the **one process / one original preview / one recorder** architecture, reduced idle footprint, native source protections, queue durability, and no additional background polling engines.
- Continue War Room's honest player profile and replay results, local FR translation, keyboard accessibility, Old Blue preservation, bounded logs and small memory footprint.
- Add Spanish only after real translated design/review and tests; do not silently label unsupported `es-ES` as translated.

## Collaboration and safety boundaries

- **Watcher branch only** for this project. Coordinate contracts via issues/PRs with app and WoloChain teams; do not edit or merge their live financial branches, migrate their databases, deploy 8094/8095, or control mainnet.
- `Emaren/app-prodn#707` owns website locale/avatar endpoint review; current app Auto Betting PR #684 and WoloChain Satchel signer/reviewer are separately held. The website production rollout of v1.6.5 remains its own protected release, not a dependency that can be 'fixed' by Watcher code.
- No live-game Win/Mac distribution claim without new exact-head CI, source + package version alignment, platform signatures/disclosures, immutable SHA256 receipts and user-approved release.
- Respect real CrossOver smoke-test observations from v1.6.5 users before broadening the capture/stream code.

## Definition of done

1. Every v1.6.6 UI claim comes from a pinned, authenticated source with explicit fresh/unknown/held statuses.
2. Verified profile identity survives re-pair/revoke checks without cross-user leaks, with FR ↔ EN choice always available.
3. Independent Watcher witness never becomes financially authoritative without separately proven trust root, raw replay bytes and bank solvency; failed proofs cannot clear HOLD.
4. npm checks, Windows/macOS/Linux packaging, security/lifecycle regression, resource comparisons and signed Windows / unsigned Mac policies pass exact-head CI.
5. Explicit separate user approval before release signing/publication; v1.6.5 public artifacts and production services remain unchanged.

## Handoff ledger

| Track | Current state | Next external dependency |
| --- | --- | --- |
| Watcher 1.6.5 binary release | PUBLISHED / certified | Real user Mac/CrossOver game canary |
| Website 1.6.5 download | Vault promoted; runtime deployment separately governed | Website-only certified deploy |
| Website profile language/avatar | Proposed / not connected | Authenticated owner-scoped read-only route, app #707 |
| Independent Watcher witness verifier | Go source integrated / financial HOLD | Source-governed signing authority + trusted raw replay reader |
| Financial Auto Bets / Satchel | HOLD / no WOLO movement | Separate reviewer, solvency, protected 8095/8094, lifecycle canary |
| Watcher 1.6.6 | **This development branch**, docs only | Scoping, tests, reviewed feature PRs |
