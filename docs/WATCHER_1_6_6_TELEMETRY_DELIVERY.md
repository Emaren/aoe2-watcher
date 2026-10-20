# Watcher 1.6.6 — Telemetry Delivery Acknowledgment, Pass 1

Status: **candidate source only**. Do not bump package version, publish binaries, merge financial branches, or claim installed-client qualification.

## Confirmed defect

1.6.5 accepted HTTP 200 as success even when the app telemetry endpoint returned `failed:1`. It therefore could retire an event that the database failed to store. The event client is separate from the reliable replay upload engine.

## Client improvement

Both immediate sends and durable retries inspect the response body and require exactly one `stored` or `suppressed` event with zero failures. Invalid or partial acknowledgments are retryable; the original telemetry event payload and `telemetryEventId` are retained across retries. Legacy upstreams that only return `{ok:true}` continue working but cannot establish verified storage.

## Server-side coordination required

The app endpoint coalesces repeated monitoring notifications. A failed original write can leave a coalescer window. Server support must identify retry of the *same failed event ID*, permit that retry, and respond non-2xx to an unsuccessful single-event write. Without the coordinated server change, client-side retry alone is insufficient to guarantee final storage of a coalesced event.

## Gates

- Existing replay uploads, finality logic and streaming untouched.
- Unit tests cover positive, negative, partial, malformed, duplicate and legacy acknowledgments.
- Cross-repository tests and server-side failure-injection required before merge.
- Real-client resource and production evidence still required for Watcher 1.6.6.
