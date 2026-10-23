---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-mac-killed-helper-recovery"
title: "Watcher 1.6.6 killed-helper recovery gate"
type: "working"
status: "draft"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "git"
authority: "watcher-1.6.6-unreleased-engineering-evidence"
reviewed_at: "2026-10-21"
review_interval_days: 14
sensitivity: "internal"
---

# Watcher 1.6.6 killed-helper recovery gate

Source-only disposable app-swap rehearsal now spawns a child process and kills it after the replacement app has been placed in its synthetic installation slot, before the health check can succeed. The test proves the old known-good app survives in backup, the candidate is still present, and a stale lock refuses any silent retry. No real app, Finder, update flow, or replay data is touched.

The future installed helper must independently authenticate the exact installed path, running PID and boot identity, signed release, update journal, backup identity, post-launch health and restoration permissions. A test-controlled health callback is not installation authority. Native Gatekeeper behavior, true power loss, sudo-free /Applications write feasibility and real 1.6.5-to-1.6.6 update remain unverified.