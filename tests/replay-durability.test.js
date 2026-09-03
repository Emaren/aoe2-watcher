const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  getRetryDelayMs,
  parseRetryAfterMs,
  readRetryAfterHeader,
} = require("../watcher");

test("Retry-After delta-seconds becomes a millisecond retry floor", () => {
  assert.equal(
    parseRetryAfterMs("5", 0),
    5000,
  );

  assert.equal(
    parseRetryAfterMs("0", 0),
    0,
  );

  assert.equal(
    parseRetryAfterMs("garbage", 0),
    0,
  );
});

test("Retry-After works with Axios-style and plain header objects", () => {
  assert.equal(
    readRetryAfterHeader({
      response: {
        headers: {
          "retry-after": "5",
        },
      },
    }),
    "5",
  );

  assert.equal(
    readRetryAfterHeader({
      response: {
        headers: {
          get(name) {
            return name === "retry-after"
              ? "7"
              : null;
          },
        },
      },
    }),
    "7",
  );
});

test("retry delay never fires before Retry-After and adds bounded jitter", () => {
  const previous =
    process.env.AOE2_UPLOAD_RETRY_BASE_DELAY_MS;

  process.env.AOE2_UPLOAD_RETRY_BASE_DELAY_MS =
    "4000";

  try {
    assert.equal(
      getRetryDelayMs(
        1,
        {},
        {
          retryAfterMs: 5000,
          random: () => 0,
        },
      ),
      5000,
    );

    assert.equal(
      getRetryDelayMs(
        1,
        {},
        {
          retryAfterMs: 5000,
          random: () => 0.5,
        },
      ),
      5500,
    );

    assert.equal(
      getRetryDelayMs(
        2,
        {},
        {
          retryAfterMs: 1000,
          random: () => 0,
        },
      ),
      8000,
    );
  } finally {
    if (previous === undefined) {
      delete process.env
        .AOE2_UPLOAD_RETRY_BASE_DELAY_MS;
    } else {
      process.env
        .AOE2_UPLOAD_RETRY_BASE_DELAY_MS =
        previous;
    }
  }
});

test("transport retries reuse one immutable replay snapshot", () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "watcher.js"
      ),
      "utf8"
    );

  assert.match(
    source,
    /let retrySnapshot = null/,
  );

  assert.match(
    source,
    /snapshot:\s*retrySnapshot/,
  );

  assert.match(
    source,
    /providedSnapshot \|\|[\s\S]*createReplayUploadSnapshot/,
  );

  assert.match(
    source,
    /if \(isReplayFinalizingError\(err\)\)[\s\S]*retrySnapshot = null/,
  );
});
