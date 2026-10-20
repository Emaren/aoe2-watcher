# Watcher 1.6.6 — Disconnected Mac updater transaction policy

**This code does not install anything.** It declares the evidence-gated transaction sequence for a future unsigned-macOS replacement helper. The existing manual 1.6.5 update and replay engine are unchanged.

State authority must progress from verified archive to verified bundle, confirmed idle, quit request, independently confirmed process exit, known-good app backup, verified swap, relaunch request, independently observed installed-app health, and final commit. Nothing may skip the process-exit, backup or health gates. After backup, any crash or interruption requires explicit independent backup/restore assessment rather than auto-declaring success.

Each transition requires a finite evidence reference (opaque receipt ID); this JavaScript module does not authenticate those receipts. The future helper must authenticate OS process identity, exact installed path, stage and bundle metadata, ownership, Gatekeeper behavior and signed release proof. A JSON transaction state is **not installation authority**. A separate durable journal and user-scoped helper still need implementation and real Mac validation.

The file is included in the packaged build only so later integration can use one reviewed policy. It is not called by the Electron update flow, cannot quit/replace apps and does not touch WoloChain, wallet or replay files.
