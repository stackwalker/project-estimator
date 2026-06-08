import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "./app.js";
import { createMemoryStore } from "./store.js";

function validPayload(id = "11111111-1111-4111-8111-111111111111") {
  return {
    id,
    title: "Project",
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        description: "Build feature",
        estimate: 3,
        metric: "hours",
        confidence: 75
      }
    ]
  };
}

function createTestApp({
  dailyCreateLimit = 25,
  burstLimit = 20,
  burstWindowSeconds = 60,
  trustProxy = false
} = {}) {
  const store = createMemoryStore({ dailyCreateLimit, quotaWindowHours: 24 });
  return {
    store,
    app: createApp({
      store,
      distDir: null,
      abuseConfig: {
        trustProxy,
        burstLimit,
        burstWindowSeconds,
        dailyCreateLimit,
        quotaWindowHours: 24,
        mongoQuotaCollection: "estimate_quotas"
      },
      deploymentMarker: "test"
    })
  };
}

async function request(app, path, options = {}) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, options);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("POST /api/estimates saves a valid estimate", async () => {
  const { app } = createTestApp();

  const response = await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload())
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.title, "Project");
});

test("POST /api/estimates returns 429 when daily quota is exceeded", async () => {
  const { app } = createTestApp({ dailyCreateLimit: 1 });

  await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload())
  });

  const response = await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload("33333333-3333-4333-8333-333333333333"))
  });

  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, "Too many estimate saves. Try again later.");
  assert.equal(Number(response.headers.get("retry-after")), body.retryAfterSeconds);
  assert.equal(body.retryAfterSeconds > 0, true);
  assert.equal(body.retryAfterSeconds <= 86400, true);
});

test("POST /api/estimates returns 409 for duplicate immutable estimates", async () => {
  const { app } = createTestApp({ dailyCreateLimit: 2 });

  await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload())
  });

  const response = await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload())
  });

  assert.equal(response.status, 409);
});

test("POST /api/estimates returns 429 when burst limiter is exceeded", async () => {
  const { app } = createTestApp({ burstLimit: 1, dailyCreateLimit: 5 });

  await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload())
  });

  const response = await request(app, "/api/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload("33333333-3333-4333-8333-333333333333"))
  });

  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, "Too many estimate save requests. Try again later.");
  assert.equal(body.retryAfterSeconds > 0, true);
});

test("POST /mcp returns tool error when daily quota is exceeded", async () => {
  const { app } = createTestApp({ dailyCreateLimit: 1 });

  const first = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "save_estimate", arguments: validPayload() }
  };
  const second = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "save_estimate",
      arguments: validPayload("33333333-3333-4333-8333-333333333333")
    }
  };

  await request(app, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(first)
  });
  const response = await request(app, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(second)
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /Try again in \d+ seconds/);
});

test("/health exposes static abuse protection metadata", async () => {
  const { app } = createTestApp({ trustProxy: true });

  const response = await request(app, "/health");
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.storage, "memory");
  assert.deepEqual(body.abuseProtection, {
    trustProxy: true,
    burstLimit: 20,
    burstWindowSeconds: 60,
    dailyCreateLimit: 25,
    quotaWindowHours: 24,
    quotaBackend: "memory"
  });
});
