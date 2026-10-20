# Watcher 1.6.6 — Compact Queue Serialization

Measured synthetic GitHub CI workload before this change: five 200-event trials showed 1.6.5 synchronous queue median duration 227.04 ms and observed timer-lag max 192.67 ms, while initial asynchronous queue median duration was 325.25 ms and observed timer lag was 0.99 ms. The async path trades wall time and RSS for reducing main-thread blocking.

This follow-up retains async atomic write/rename and corrupted-file safeguards, but writes compact canonical JSON instead of whitespace-indented JSON. Legacy indented files are still parsed normally and rewritten only when queue content legitimately changes. No change to queue capacity, retry FIFO, event IDs, uploader, video or game admission.

The CI comparison must be rerun on this exact commit before claiming any performance improvement. The benchmark is a synthetic Node queue workload, NOT installed Electron idle power or real replay performance.
