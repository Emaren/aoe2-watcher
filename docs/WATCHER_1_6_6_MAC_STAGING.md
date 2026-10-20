# Watcher 1.6.6 — Secure unsigned-Mac staging (isolated draft)

This is **a disconnected pre-install module**, not a working/activated updater. The in-app unsigned Mac flow remains manual. The public release remains 1.6.5.

## Security contracts

- Accepts only a previously Ed25519-verified manifest proof, authenticated inside the manifest verifier via its private WeakSet; copied or fabricated objects are rejected.
- Default transport uses HTTPS without bearer/API/wallet headers, rejects redirects, refuses HTTP non-200, transfer compression and HTML; release URL and architecture are fixed in the independently signed proof.
- A user-owned directory with no group/other write permission is required, then a private 0700 staging root and a fresh 0700 random directory per attempt.
- Exclusive `0600` no-follow partial file, binary streaming and byte ceilings prevent a memory-heavy full-ZIP buffer or overlong response.
- A SHA-256 of actual downloaded bytes must equal the signed hash, size must be exact, and contents are fsynced before the final stage rename. Failed attempts delete only their own new candidate folder.
- No archive extraction, chmod on existing apps, trust prompts, shell, root, userData modifications outside the staging root, process termination, installation or relaunch.

## Still intentionally unimplemented

Real offline release-key ceremony/pinned public key, signed manifest publisher, first-party no-redirect artifact delivery, constrained installer helper, replay/stream idle fence, bundle inspection, app swap, crash recovery journal, relaunch health, rollback, and physical Mac Gatekeeper canary. Require authenticated archive manifest and independently verified bundle content before ever calling a process-exit replacement helper.

Tests exercise mocked HTTPS response *streams*, not a real network transfer, which is an outstanding integration gate.
