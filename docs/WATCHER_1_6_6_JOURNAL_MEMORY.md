# Watcher 1.6.6 — Bounded Journal Failure Memory (candidate)

Source-only engineering pass. The 1.6.5 replay upload, recovery, finality, import and native streaming engines remain unchanged.

On 1.6.5, runtime diagnostic disk write errors preserve failed JSONL chunks in a pending array without a total memory cap. A persistent full or read-only filesystem can therefore create increasing client memory use. 1.6.6 proposes a **1 MiB default pending diagnostic-memory limit**, clamped to at most 8 MiB.

The oldest complete pending chunks are dropped only when the disk cannot keep up; a console diagnostic counts the loss explicitly. Chunks are never truncated to partial JSON lines. On healthy disks, queue order and journal write behavior remain unchanged. This diagnostic queue never contains replay snapshot data and does not change upload delivery semantics.

Qualification requires 5,000-chunk failure stress, UTF-8 correctness, callback-failure isolation, quit-drain path inspection, and physical high-load resource benchmarks before release. No assertion of field improvement is made here.
