---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-update-experience"
title: "Watcher 1.6.6 One-Click Update and Install Experience"
type: "working"
status: "active"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher", "app-prodn"]
audience: ["developers", "operators", "ai-agents"]
source_of_truth: "git"
authority: "watcher-1.6.6-owner-approved-updater-acceptance"
reviewed_at: "2026-10-19"
review_interval_days: 30
sensitivity: "internal"
---

# Watcher 1.6.6 — One-click update, no installer scavenger hunt

**P0 product directive from the 2026-10-19 real 1.6.5 Mac installation.**
Issue: [#49](https://github.com/Emaren/aoe2-watcher/issues/49).
This is the **engineering acceptance contract** for 1.6.6, not evidence of implementation, testing, or publication. Production package.json remains v1.6.5 until separately qualified.

## What failed and why

A verified 1.6.5 macOS arm64 DMG from the real production website was opened, and Finder rejected the copy to Applications:

> The operation can't be completed because the item "AoE2HDBets Watcher" is in use.

**Cause 1 — old process still using installed app:** Classic Watcher can remain running in the tray even when its window is closed. Finder cannot replace that running application in Applications. The updater must orchestrate quitting and post-exit replacement; asking the player to drag a second copy cannot satisfy the final user experience.

**Cause 2 — deliberate unsigned-Mac update gate:** v1.6.5 `updatePolicy.js::getUpdateCapability()` returns manual-only for unsigned macOS. Mac signed/native `electron-updater` path specifically requires paid Developer ID notarization and identity validation. Merely wiring the Update button to the existing `quitAndInstall()` is **not an implementation** of unsigned-Mac updates and risks broken/Squirrel delayed quit behavior.

**Cause 3 — website regression:** v1.6.5 website download page replaced its working Mac recovery command with warning-only copy, leaving no immediate recovery when Gatekeeper blocks a verified unsigned app. The original app-scoped command has been restored in a separate website branch:

```bash
xattr -dr com.apple.quarantine "/Applications/AoE2HDBets Watcher.app"
open "/Applications/AoE2HDBets Watcher.app"
```

This is a **one-time manual fallback for an official, independently verified download**, not a global Mac security policy or substitute for graceful quit while the old app is in use. If Finder says "in use", quit the old Watcher (tray process included) *before* replacing the bundle. No system-wide `spctl --master-disable` or root privileges.

## Owner release economics are settled

- **Windows:** Maintain paid Azure Artifact Signing and timestamp verification. Installed NSIS builds already have in-app background update machinery. Portable edition may require an explicit replacement handoff.
- **macOS:** Official builds are **unsigned, not Apple-notarized** while AoE2WAR has no revenue supporting the USD $99/year Apple Developer subscription. Never ask to buy the subscription again absent an explicit owner decision. The objective is to engineer the lowest-friction secure updater compatible with that policy.
- **Linux:** AppImage path retains supported in-app update behavior when real `APPIMAGE` binding and source trust exist.
- **Honest limitation:** unsigned macOS software may still elicit OS-controlled Gatekeeper approval. No application implementation can guarantee that macOS will never ask for approval without a trusted Developer ID/notarization path. Eliminate all *avoidable* Finder, download-folder, mounted-DMG and Terminal friction; disclose genuinely unavoidable OS approval in-app.

## Target player experience

From War Room or Old Blue: **Update available → Update → downloading 0–100% inside Watcher → verifying → waiting for safe idle → installing → Watcher relaunches on newest version.** No Finder window, Downloads file, DMG dragging, external ZIP extraction, repeated manual process checking, or separate command on the normal path.

Use one shared updater state and IPC in both appearances. The user can postpone while streaming or playing a live game. If a safe-quit requirement cannot be satisfied, leave the old Watcher running and provide a precise actionable error, never claim successful installation.

## Non-negotiable security and correctness gates

1. The updater must fetch only stable, strictly newer, exact channel artifacts from allowlisted first-party HTTPS release origins; reject unexpected redirects, host, basename, MIME, size or architecture. Never send Watcher API keys, Keplr credentials or account tokens with artifact requests.
2. **End-to-end authenticity:** verify a detached release manifest signed by an offline release key (e.g. Ed25519 public key pinned in installed Watcher), with immutable expected version, runtime/source SHA, asset size and SHA-256. A hash downloaded from the same untrusted source by itself is *not* sufficient authentication. Integrate signing with the existing 12-file certified release manifest and publication controller without weakening Windows Authenticode.
3. Stage privately using the regular user's writable application cache, verify available space, enforce file-size quotas, atomic temp filenames and safe paths; reject traversal, symlinks and untrusted archives. Keep userData, config, pairing and replay directories untouched.
4. Reuse existing workload fences: finish active replay scans, uploads, historical imports, capture and native streaming; never auto-interrupt a live AoE2 match or broadcast. Serialize version checks, download/install events and click handlers; bound retry/backoff.
5. On macOS spawn a **separately reviewed user-scoped replacement helper** that waits for the *real Watcher main process to terminate*, then verifies the staged app bundle, known bundle ID/path, and install parent, backs up old app, safely replaces, launches the intended verified application and waits for post-restart heartbeat/version proof. Do not emulate signed native Squirrel by setting `AOE2_ENABLE_MAC_AUTO_UPDATE` or circumventing its identity tests.
6. Journal every transition and durable receipt: requested, downloaded, verified, quiescing, quit, staging, swapped, relaunched, acknowledged, cleanup or rolled_back. Roll back to a known-good installed copy on failure. Survive interrupted download, power loss, stale helpers, app already in use, duplicate simultaneous Watchers, or permission failure.
7. Do not silently clear quarantine on arbitrary files, disable macOS security globally, or elevate to root. If explicit OS user approval remains necessary, present one short native instruction instead of false "friction-free" claims.
8. Windows installed NSIS and supported AppImage updates must continue working, with signature/digest and safe-idle gates unchanged. Manual portable fallback should offer an in-app handoff and authenticated link.
9. Update progress must reflect **actual** progress and verified state; no invented completion percentage or "installed" state based solely on a successful `quitAndInstall()` call.

## Acceptance matrix and real canaries

| Test | Expected |
| --- | --- |
| 1.6.5 → 1.6.6 Mac user-scoped in-app update | One Update action, no Finder/DMG/Downloads interaction on normal path, same profile and pairing |
| Old Watcher process still running | Helper waits for *quit completion* and never attempts to overwrite in-use app |
| Idle Watcher armed | Gracefully stops idle watcher, installs and restarts without losing replay monitoring |
| Live AoE2 game or stream | Download may finish; **install deferred** until safe idle |
| Failed hash/signature or swapped artifact | Hard stop, original app continues, no install or exposed secret |
| Interrupted staging, network loss or power failure | Recoverable journal, bounded retry, no half-installed app |
| Relaunch doesn't confirm version/health | Restore prior verified app, durable receipt and explicit next action |
| EN/FR and War Room / Old Blue | Same update state, language preference and avatar unchanged |
| macOS Gatekeeper case with unsigned app | No global bypass; actionable OS consent if strictly needed |
| Windows installed NSIS and Linux AppImage | Existing safe update paths pass and continue auto-relaunch |
| Native macOS install (not mock) | Mac/CrossOver canary with real 1.6.5→1.6.6 transition confirms process exit, swap, app launch, low resource use |

**Do not release 1.6.6** until the new Mac path has actual physical installed-app evidence; dynamic tests and unsigned packaging alone are insufficient. New release receipt binds OS-specific binary hashes and updater manifest signature, exact source, runtime, result, rollback. No app/chain financial deployment is authorized by this plan.

## Inherited boundaries

Original Old Blue remains functional, with one recorder and replay-truth engine. War Room remains presentation only; no synthetic wins/losses, RM/DM scores, stream audiences or wallet balances. Website-owned War Satchel and Auto Bets stay held, read-only until independently authorized. Native update tooling does not modify `Emaren/app-prodn`, `Emaren/api-prodn` or `Emaren/wolochain` on behalf of a Watcher update.

See 1.6.4 updater lifecycle contract for existing safe-idle worker and one-process behavior, and 1.6.5 War Room contract for appearance requirements.
