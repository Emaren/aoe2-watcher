"use strict";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const HARD_MAX_BYTES = 8 * 1024 * 1024;

// The actual journal stays on disk and keeps its existing atomic rotation.
// This queue is only for chunks waiting after failed disk writes. It never
// receives replay payloads, pairing credentials, or financial state.
function createBoundedPendingJournalWrites({
  maxBytes = DEFAULT_MAX_BYTES,
  onDrop = () => {},
} = {}) {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? Math.min(HARD_MAX_BYTES, maxBytes)
    : DEFAULT_MAX_BYTES;
  const entries = [];
  let bytes = 0;
  let droppedChunks = 0;
  let droppedBytes = 0;

  function notice(count, amount) {
    if (count <= 0) return;
    droppedChunks += count;
    droppedBytes += amount;
    try { onDrop({ droppedChunks: count, droppedBytes: amount }); } catch {}
  }

  return {
    get length() { return entries.length; },
    peek() { return entries.length ? entries[0].text : undefined; },
    push(text) {
      if (typeof text !== "string" || text.length === 0) return entries.length;
      const nextBytes = Buffer.byteLength(text, "utf8");
      // Do not slice a JSONL chunk into malformed partial records.
      if (nextBytes > limit) {
        notice(1, nextBytes);
        return entries.length;
      }
      let dropCount = 0;
      let dropBytes = 0;
      while (bytes + nextBytes > limit && entries.length > 0) {
        const dropped = entries.shift();
        bytes -= dropped.bytes;
        dropCount += 1;
        dropBytes += dropped.bytes;
      }
      notice(dropCount, dropBytes);
      entries.push({ text, bytes: nextBytes });
      bytes += nextBytes;
      return entries.length;
    },
    shift() {
      const first = entries.shift();
      if (!first) return undefined;
      bytes -= first.bytes;
      return first.text;
    },
    // A detached snapshot supports deterministic journal-failure testing.
    snapshot() { return entries.map(entry => entry.text); },
    stats() {
      return { queuedChunks: entries.length, pendingBytes: bytes,
        maxBytes: limit, droppedChunks, droppedBytes };
    },
  };
}

module.exports = { createBoundedPendingJournalWrites };
