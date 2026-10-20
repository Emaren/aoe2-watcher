# Watcher 1.6.6 — Frozen replay golden core

The 1.6.6 candidate must improve the surrounding telemetry, diagnostics, updater and release safety **without changing the published 1.6.5 replay engine's behavior**.

We checked the actual Git content-blob identities at v1.6.5 and the candidate, then pinned five bytes-identical modules in an automated Node regression check:

- watcher.js: 1ce3db9ec9295eb1b30e00404958972ba02f2d83
- replayProvenancePolicy.js: d3a1f841944bfc8c9bf0bdbf4cb4160962ca41f9
- streamHandoff.js: 1fb1e0b02faf14b0b8914339133f73d3b00effad
- networkPriority.js: ac7b7645d093f707d5d0ee83033c5edb35b2c4ce
- runtimePolicy.js: 1a37f736ba7750fbbf0f427128ece732004957b4

The test computes each file's real Git blob SHA-1, not a guessed source checksum or an online branch comparison. This catches accidental modifications to the reliable replay ingress/finality/retry core.

A deliberate future optimization is possible, but requires explicit baseline revision, frozen 1.6.4/1.6.5 replay-corpus equivalence tests, and real game-upload canaries. A passing hash fence alone is not proof that integrations in main.js and server ingestion never regress; those still need cross-repository failure injection and installed-client testing.

Source-only gate, no additional Watcher background activity, no release or financial activation.
