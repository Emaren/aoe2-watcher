# Watcher 1.6.6 — Native ZIP symlink-chain and parent-path hardening

The release-time ZIP policy now rejects an archive with an entry stored **beneath another archive entry that is itself a symlink or ordinary file**. Even an in-app symlink can redirect the extractor to a different location and overwrite a file unexpectedly. It also refuses case-insensitive collisions between implicitly created parent folders, cyclic or dangling symlink chains and chains that ultimately escape the signed application root.

Normal contained Electron framework alias links, including a chain from `Current` to `Versions/A` and then a library file, remain allowed. No ZIP extraction is performed by this preflight. Synthetic attack tests are supplemented by the real updater-native ZIP audit and the separate post-extraction application inspection on the macOS runner.

This is source/release-time validation, **not** a replacement for a vetted runtime extractor or trusted Mac installation helper. The published replay engine, version and production binaries are unchanged.
