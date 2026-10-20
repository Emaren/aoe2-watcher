# Watcher 1.6.6 — Actual extracted Mac bundle proof

Release-time CI now inspects the actual native updater ZIP **both before and after extraction**. The existing release-time ZIP policy auditor checks name traversal, contained symlinks, compressed/extracted limits and integrity. A disposable macOS runner directory (0700) then receives the ZIP through Apple's system `ditto` utility.

The independent `macUnsignedUpdateBundleAudit.js` reads real `Info.plist` via `plutil` and verifies the exact application identifier, version, Mach-O architecture, bounded application tree and symlink containment. The staging directory is deleted after qualification. The same proof runs on normal macOS packaging and the separate non-Windows release workflow.

This is an **ephemeral CI validation**, not an activated Watcher installer and not proof that `ditto` itself is a safe untrusted-input extraction strategy on an end-user computer. The native one-click Mac updater still needs a separately reviewed installed-runtime extractor and rollback helper; no updater activation occurs here. The public Watcher version remains 1.6.5, and its replay engine is unchanged.
