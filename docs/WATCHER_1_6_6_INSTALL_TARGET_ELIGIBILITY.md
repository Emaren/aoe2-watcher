# Watcher 1.6.6 — Read-only user-owned install-target eligibility

The Watcher presently may be installed in `/Applications/AoE2HDBets Watcher.app`. A nonprivileged user-scoped helper must **not** infer it can overwrite a root-owned application there. This source-only diagnostic classifies that exact target as `migration_required`; it does not move, delete, or elevate anything.

A user-owned `~/Applications/AoE2HDBets Watcher.app` may qualify as a future candidate only when the installation, home and staging directories are real directories owned by the active user, not symlinks, are on the same volume, and meet strict permissions. Even then, the result is **advisory** (`verifiedInstallAuthority:false`) because ACL, process liveness, security consent and filesystem identity can change before installation. Any real helper must repeat the checks immediately before changing an app.

The synthetic tests use disposable directories, never /Applications and never the real Watcher. This module is not packaged, imported or activated. No claims about actual Mac ownership, Gatekeeper approvals or one-click capability are made; obtaining that evidence requires the connected Mac and user's installation location.
