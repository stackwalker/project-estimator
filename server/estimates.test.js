import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitError } from "./abuse.js";
import { createEstimate, buildEstimate, isGuid } from "./estimates.js";
import { createMemoryStore } from "./store.js";

const estimateId = "11111111-1111-4111-8111-111111111111";

function payload(overrides = {}) {
  return {
    id: estimateId,
    title: "Project",
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        description: "Build feature",
        estimate: 3,
        metric: "hours",
        confidence: 75
      }
    ],
    ...overrides
  };
}

test("isGuid accepts valid estimate IDs and rejects invalid IDs", () => {
  assert.equal(isGuid(estimateId), true);
  assert.equal(isGuid("not-a-guid"), false);
});

test("buildEstimate validates and normalizes estimate payloads", () => {
  const estimate = buildEstimate(payload({ title: "  Project  " }), new Date("2026-06-08T00:00:00.000Z"));

  assert.equal(estimate.id, estimateId);
  assert.equal(estimate.title, "Project");
  assert.equal(estimate.status, "saved");
  assert.equal(estimate.createdAt, "2026-06-08T00:00:00.000Z");
  assert.equal(estimate.items[0].description, "Build feature");
});

test("createEstimate saves a valid estimate after reserving quota", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 1, quotaWindowHours: 24 });

  const estimate = await createEstimate({
    payload: payload(),
    store,
    clientKey: "ip:127.0.0.1",
    now: new Date("2026-06-08T00:00:00.000Z")
  });

  assert.equal(estimate.id, estimateId);
  assert.deepEqual(await store.get(estimateId), estimate);
});

test("createEstimate validates before consuming durable quota", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 1, quotaWindowHours: 24 });

  await assert.rejects(
    () =>
      createEstimate({
        payload: payload({ items: [] }),
        store,
        clientKey: "ip:127.0.0.1",
        now: new Date("2026-06-08T00:00:00.000Z")
      }),
    /Add at least one line item/
  );

  const estimate = await createEstimate({
    payload: payload(),
    store,
    clientKey: "ip:127.0.0.1",
    now: new Date("2026-06-08T00:00:01.000Z")
  });

  assert.equal(estimate.id, estimateId);
});

test("createEstimate releases quota when a duplicate immutable estimate is rejected", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 1, quotaWindowHours: 24 });

  await createEstimate({
    payload: payload(),
    store,
    clientKey: "ip:127.0.0.1",
    now: new Date("2026-06-08T00:00:00.000Z")
  });

  await assert.rejects(
    () =>
      createEstimate({
        payload: payload(),
        store,
        clientKey: "ip:198.51.100.10",
        now: new Date("2026-06-08T00:01:00.000Z")
      }),
    /already saved/
  );

  const secondEstimate = await createEstimate({
    payload: payload({ id: "33333333-3333-4333-8333-333333333333" }),
    store,
    clientKey: "ip:198.51.100.10",
    now: new Date("2026-06-08T00:02:00.000Z")
  });

  assert.equal(secondEstimate.id, "33333333-3333-4333-8333-333333333333");
});

test("createEstimate raises RateLimitError when daily quota is exceeded", async () => {
  const store = createMemoryStore({ dailyCreateLimit: 1, quotaWindowHours: 24 });

  await createEstimate({
    payload: payload(),
    store,
    clientKey: "ip:127.0.0.1",
    now: new Date("2026-06-08T00:00:00.000Z")
  });

  await assert.rejects(
    () =>
      createEstimate({
        payload: payload({ id: "33333333-3333-4333-8333-333333333333" }),
        store,
        clientKey: "ip:127.0.0.1",
        now: new Date("2026-06-08T00:01:00.000Z")
      }),
    (error) =>
      error instanceof RateLimitError &&
      error.limitType === "daily" &&
      error.retryAfterSeconds === 86340
  );
});
