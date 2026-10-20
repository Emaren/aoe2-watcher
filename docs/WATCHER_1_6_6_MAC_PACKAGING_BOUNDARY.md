# Watcher 1.6.6 — Keep unfinished Mac updater modules outside distributables

The new macUnsignedUpdate* signer verification, staging, bundle audit, transaction and crash journal files are **reviewable source/test assets**. They have no production call site, verified public release key, trusted ZIP extraction implementation or independently qualified process-exit/rollback helper. Adding them to electron-builder's explicit build.files array would inflate installer payload and complicate interpretation of unfinished code as ready for use.

This pass excludes the five disconnected files from packaged builds, keeps them in Git and running tests, and adds a regression test that prevents the production main process from importing them without an explicit later packaging/integration review.

When the authenticated one-click helper is finished, update both the import/call site and explicit release packaging list in the same review, followed by physical Mac tests. This pass does not weaken signed/native updater gates, replay upload, or any existing 1.6.5 behavior. Version remains 1.6.5 in the candidate.

It is not an installed-memory/CPU improvement: uncalled modules were not executing. The objective improvement is eliminating unused distribution files and reducing accidental future activation risk.
