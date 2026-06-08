import assert from "node:assert/strict";
import test from "node:test";
import {
  RateLimitError,
  createAbuseConfig,
  createBurstLimiter,
  formatRetryMessage,
  getClientKey,
  parseBoolean,
  parsePositiveInteger
} from "./abuse.js";

test("burst limiter allows requests within the configured window", () => {
  const limiter = createBurstLimiter({ limit: 2, windowSeconds: 60 });

  assert.equal(limiter.check("ip:127.0.0.1", 1_000).allowed, true);
  assert.equal(limiter.check("ip:127.0.0.1", 2_000).allowed, true);
});

test("burst limiter rejects requests over the configured window", () => {
  const limiter = createBurstLimiter({ limit: 2, windowSeconds: 60 });

  limiter.check("ip:127.0.0.1", 1_000);
  limiter.check("ip:127.0.0.1", 2_000);
  const result = limiter.check("ip:127.0.0.1", 3_000);

  assert.equal(result.allowed, false);
  assert.equal(result.limitType, "burst");
  assert.equal(result.retryAfterSeconds, 58);
});

test("burst limiter resets after the configured window", () => {
  const limiter = createBurstLimiter({ limit: 2, windowSeconds: 60 });

  limiter.check("ip:127.0.0.1", 1_000);
  limiter.check("ip:127.0.0.1", 2_000);

  assert.equal(limiter.check("ip:127.0.0.1", 61_001).allowed, true);
});

test("RateLimitError carries retry metadata", () => {
  const error = new RateLimitError("Too many requests.", {
    limitType: "daily",
    retryAfterSeconds: 120
  });

  assert.equal(error.name, "RateLimitError");
  assert.equal(error.limitType, "daily");
  assert.equal(error.retryAfterSeconds, 120);
});

test("config parsing applies defaults and numeric overrides", () => {
  const config = createAbuseConfig({
    TRUST_PROXY: "true",
    ESTIMATE_BURST_LIMIT: "7",
    ESTIMATE_BURST_WINDOW_SECONDS: "30",
    ESTIMATE_DAILY_CREATE_LIMIT: "11",
    ESTIMATE_QUOTA_WINDOW_HOURS: "12",
    MONGODB_QUOTA_COLLECTION: "quota_docs"
  });

  assert.deepEqual(config, {
    trustProxy: true,
    burstLimit: 7,
    burstWindowSeconds: 30,
    dailyCreateLimit: 11,
    quotaWindowHours: 12,
    mongoQuotaCollection: "quota_docs"
  });
});

test("primitive parsers normalize invalid values", () => {
  assert.equal(parseBoolean("true", false), true);
  assert.equal(parseBoolean("false", true), false);
  assert.equal(parseBoolean(undefined, true), true);
  assert.equal(parsePositiveInteger("0", 9), 9);
  assert.equal(parsePositiveInteger("abc", 9), 9);
  assert.equal(parsePositiveInteger("4", 9), 4);
});

test("client key normalizes missing and present request IPs", () => {
  assert.equal(getClientKey({ ip: "::ffff:192.0.2.3" }), "ip:192.0.2.3");
  assert.equal(getClientKey({ socket: { remoteAddress: "127.0.0.1" } }), "ip:127.0.0.1");
  assert.equal(getClientKey({}), "ip:unknown");
});

test("retry messages include retry timing", () => {
  assert.equal(
    formatRetryMessage(new RateLimitError("Too many estimate saves.", {
      limitType: "daily",
      retryAfterSeconds: 90
    })),
    "Too many estimate saves. Try again in 90 seconds."
  );
});
