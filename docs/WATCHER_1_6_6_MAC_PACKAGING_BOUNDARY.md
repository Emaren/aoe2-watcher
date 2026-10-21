---
id: "aoe2war.aoe2-watcher.docs-watcher-1-6-6-mac-packaging-boundary"
title: "Watcher 1.6.6 — Keep unfinished Mac updater modules outside distributables"
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

# Watcher 1.6.6 — Keep unfinished Mac updater modules outside distributables

The new macUnsignedUpdate* signer verification, staging, bundle audit, transaction and crash journal files are **reviewable source/test assets**. They have no production call site, verified public release key, trusted ZIP extraction implementation or independently qualified process-exit/rollback helper. Adding them to electron-builder's explicit build.files array would inflate installer payload and complicate interpretation of unfinished code as ready for use.

This pass excludes the five disconnected files from packaged builds, keeps them in Git and running tests, and adds a regression test that prevents the production main process from importing them without an explicit later packaging/integration review.

When the authenticated one-click helper is finished, update both the import/call site and explicit release packaging list in the same review, followed by physical Mac tests. This pass does not weaken signed/native updater gates, replay upload, or any existing 1.6.5 behavior. Version remains 1.6.5 in the candidate.

It is not an installed-memory/CPU improvement: uncalled modules were not executing. The objective improvement is eliminating unused distribution files and reducing accidental future activation risk.

## Fail-closed main-process import closure

The explicit Electron `build.files` allowlist formerly omitted two imported
runtime helpers, `backgroundTimerPolicy.js` and `diagnosticLimits.js`.
The source test suite still passed, but a built `app.asar` could fail when
the main process loaded those absent modules. Both helper files now belong
in every native distribution.

The built-artifact auditor now walks **real archive root JavaScript files**,
recognizes static local CommonJS imports, and rejects missing relative modules,
path escapes, and incomplete root dependency closure. An adversarial ASAR
fixture deliberately omits a required module, proves the inspector refuses
the package, then adds the module and proves the archive passes. A separate
source test checks every direct `main.js` static local import against the
packaging allowlist. Windows/macOS/Linux native CI must inspect their actual
built ASAR, not rely on source manifests alone.

This check does **not** assert that every dynamic import is statically
discoverable, that an Electron user-session boot succeeded, or that Mac
upgrading/rollback is qualified. The disconnected Mac update helper set
remains deliberately excluded from every production candidate.

## Real Linux Electron main/renderer boot gate (source-candidate CI)

Source-only tests and root CommonJS import inspection establish file
presence, but do not establish that the actual native application starts.
Linux CI now boots the real `dist/linux-unpacked` Electron executable
under Xvfb and requires **both** `Runtime initialized:` and `Dashboard
renderer ready` log receipts. A failed process, missing window bootstrap,
unresolved runtime dependency, or 35-second readiness timeout fails the
qualification job.

The CI host uses a newly created permission-private HOME, XDG directories,
empty replay folder, deliberately absent watcher API key and disabled
heartbeat; API/telemetry/update addresses point to loopback. It terminates
the entire test process group and deletes the sandbox profile afterwards.
The smoke runs only against the built artifact; no instrumentation or extra
polling is bundled into users' applications.

This qualifies an isolated hosted-runner **Linux GUI boot**, not an
installed Windows/macOS app, real match/replay upload, update
signing/rollback, or idle/live device power. The physical OS and
protected server release gates remain separate and mandatory.
