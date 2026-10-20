# Watcher 1.6.6 — Diagnostic queue handle-level read safety

An earlier telemetry queue revision used `lstat(path)` followed by `readFile(path)`. Between those operations, a path can be replaced by a symlink (time-of-check/time-of-use), potentially reading a different local file. This pass opens the diagnostic file with native `O_NOFOLLOW` when the operating system provides it, validates the exact opened handle's file type and size, reads from that handle, and rejects a changed/oversize snapshot.

Windows lacks the POSIX no-follow flag: the pre-existing `lstat` guard remains in place there, but its ACL/race behavior is **not** claimed equal to the POSIX guarantee. The future physical Windows canary must validate native permissions separately.

The queue still serializes operations, preserves malformed records for recovery, and does not touch actual game replay uploading. No background polling or new timers are introduced; this is diagnostic persistence only. The pinned synthetic queue benchmark must be rerun for performance evidence before asserting a speed impact.
