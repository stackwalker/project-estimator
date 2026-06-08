import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "./store.js";

function estimate(id = "11111111-1111-4111-8111-111111111111") {
  return {
    id,
    title: "Estimate",
    status: "saved",
    createdAt: "2026-06-08T00:00:00.000Z",
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        description: "Build thing",
        estimate: 4,
        metric: "hours",
        confidence: 80
      }
    ]
  };
}

test("memory store saves estimates immutably by id", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 2, quotaWindowHours: 24 });
  const document = estimate();

  assert.equal(await store.save(document), true);
  assert.deepEqual(await store.get(document.id), document);
  assert.equal(await store.save(document), false);
});

test("memory quota allows reservations below the daily limit", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 2, quotaWindowHours: 24 });

  const first = await store.reserveCreateQuota("ip:127.0.0.1", new Date("2026-06-08T00:00:00.000Z"));
  const second = await store.reserveCreateQuota("ip:127.0.0.1", new Date("2026-06-08T01:00:00.000Z"));

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
});

test("memory quota rejects reservations over the daily limit with retry timing", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 2, quotaWindowHours: 24 });

  await store.reserveCreateQuota("ip:127.0.0.1", new Date("2026-06-08T00:00:00.000Z"));
  await store.reserveCreateQuota("ip:127.0.0.1", new Date("2026-06-08T01:00:00.000Z"));
  const rejected = await store.reserveCreateQuota(
    "ip:127.0.0.1",
    new Date("2026-06-08T02:00:00.000Z")
  );

  assert.deepEqual(rejected, {
    allowed: false,
    limitType: "daily",
    retryAfterSeconds: 79200
  });
});

test("memory quota release returns a reservation to the window", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 1, quotaWindowHours: 24 });

  const reservation = await store.reserveCreateQuota(
    "ip:127.0.0.1",
    new Date("2026-06-08T00:00:00.000Z")
  );
  assert.equal(reservation.allowed, true);

  await store.releaseCreateQuota(reservation.reservation);
  const replacement = await store.reserveCreateQuota(
    "ip:127.0.0.1",
    new Date("2026-06-08T01:00:00.000Z")
  );

  assert.equal(replacement.allowed, true);
});

test("memory quota starts a new window after expiry", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 1, quotaWindowHours: 24 });

  await store.reserveCreateQuota("ip:127.0.0.1", new Date("2026-06-08T00:00:00.000Z"));
  const nextWindow = await store.reserveCreateQuota(
    "ip:127.0.0.1",
    new Date("2026-06-09T00:00:00.000Z")
  );

  assert.equal(nextWindow.allowed, true);
});
