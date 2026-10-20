# Watcher 1.6.6 — Measured Queue Microbenchmark

A synthetic microbenchmark is included so we can compare the old synchronous telemetry queue and the 1.6.6 async queue **on the same host and toolchain**. It does not measure an Electron renderer, games, installed binary, video encoding, real network or power.

Run the current candidate:
```bash
npm run benchmark:telemetry -- ./telemetryQueue.js 300
```

To compare against 1.6.5, supply the **exact v1.6.5** `telemetryQueue.js` as the path argument; use a separate pristine checkout or `git show v1.6.5:telemetryQueue.js` to write a temporary comparison module. Run several repetitions in alternating order under the same Node runtime, disk, host, load, sample count and OS; compare medians rather than cherry-picking a run.

The JSON report captures wall duration, event-loop utilization, p95/max delay, observed 10-ms timer lag, RSS delta and durable queue correctness. The benchmark allocates only disposable temporary files and never reads Watcher userData or production telemetry.

## Cautions
- Faster wall-time is not automatically better; reduced main-thread blocking can cost additional async scheduling.
- The native telemetry queue behavior itself is tested separately.
- No 100/100 or no-regression certification follows from this microbenchmark alone. Physical Electron cohort comparisons on Windows/macOS/Linux are still mandatory.
