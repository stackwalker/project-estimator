import express from "express";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RateLimitError, createAbuseConfig, createBurstLimiter, getClientKey } from "./abuse.js";
import { createEstimate } from "./estimates.js";
import { createMcpHandler } from "./mcp.js";
import { createEstimateStore } from "./store.js";

export const deploymentMarker = "github-actions-validation-2026-06-05";

function logRateLimit({ error, clientKey, route }) {
  console.warn(
    JSON.stringify({
      event: "rate_limit_rejected",
      limitType: error.limitType,
      clientKey,
      route,
      retryAfterSeconds: error.retryAfterSeconds
    })
  );
}

function rateLimitResponse(res, error) {
  res.set("Retry-After", String(error.retryAfterSeconds));
  res.status(429).json({
    error:
      error.limitType === "burst"
        ? "Too many estimate save requests. Try again later."
        : "Too many estimate saves. Try again later.",
    retryAfterSeconds: error.retryAfterSeconds
  });
}

function createBurstMiddleware({ burstLimiter }) {
  return function burstMiddleware(req, res, next) {
    const clientKey = getClientKey(req);
    const result = burstLimiter.check(clientKey);

    if (!result.allowed) {
      const error = new RateLimitError("Too many estimate save requests.", result);
      logRateLimit({ error, clientKey, route: req.path });
      rateLimitResponse(res, error);
      return;
    }

    next();
  };
}

export function createApp({ store, abuseConfig, distDir, deploymentMarker: marker = deploymentMarker }) {
  const app = express();
  const burstLimiter = createBurstLimiter({
    limit: abuseConfig.burstLimit,
    windowSeconds: abuseConfig.burstWindowSeconds
  });
  const burstMiddleware = createBurstMiddleware({ burstLimiter });
  const handleMcpRequest = createMcpHandler({
    createEstimate: ({ payload, clientKey }) =>
      createEstimate({
        payload,
        store,
        clientKey,
        now: new Date()
      })
  });

  if (abuseConfig.trustProxy) {
    app.set("trust proxy", true);
  }

  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      storage: store.name,
      marker,
      abuseProtection: {
        trustProxy: abuseConfig.trustProxy,
        burstLimit: abuseConfig.burstLimit,
        burstWindowSeconds: abuseConfig.burstWindowSeconds,
        dailyCreateLimit: abuseConfig.dailyCreateLimit,
        quotaWindowHours: abuseConfig.quotaWindowHours,
        quotaBackend: store.quotaBackendName
      }
    });
  });

  app.get("/api/estimates/:id", async (req, res, next) => {
    try {
      const estimate = await store.get(req.params.id);

      if (!estimate) {
        res.status(404).json({ error: "Estimate not found." });
        return;
      }

      res.json(estimate);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/estimates", burstMiddleware, async (req, res, next) => {
    const clientKey = getClientKey(req);

    try {
      const estimate = await createEstimate({
        payload: req.body,
        store,
        clientKey,
        now: new Date()
      });
      res.status(201).json(estimate);
    } catch (error) {
      if (error instanceof RateLimitError) {
        logRateLimit({ error, clientKey, route: req.path });
        rateLimitResponse(res, error);
        return;
      }

      const status = error.message.includes("already saved") ? 409 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  app.post("/mcp", burstMiddleware, async (req, res, next) => {
    try {
      const messages = Array.isArray(req.body) ? req.body : [req.body];
      const clientKey = getClientKey(req);
      const responses = (
        await Promise.all(messages.map((message) => handleMcpRequest({ message, clientKey })))
      ).filter(Boolean);

      if (responses.length === 0) {
        res.status(204).send();
        return;
      }

      res.type("application/json").json(Array.isArray(req.body) ? responses : responses[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      error: "This MCP server supports JSON-RPC requests over HTTP POST at /mcp."
    });
  });

  if (distDir) {
    app.use(express.static(distDir));

    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}

export function createRuntimeFromEnv(env = process.env) {
  const abuseConfig = createAbuseConfig(env);
  const storageDriver = (env.ESTIMATE_STORE || (env.MONGODB_URI ? "mongodb" : "memory")).toLowerCase();
  const store = createEstimateStore({
    storageDriver,
    mongoUri: env.MONGODB_URI,
    mongoDatabase: env.MONGODB_DB || "estimator",
    mongoCollection: env.MONGODB_COLLECTION || "estimates",
    mongoQuotaCollection: abuseConfig.mongoQuotaCollection,
    dailyCreateLimit: abuseConfig.dailyCreateLimit,
    quotaWindowHours: abuseConfig.quotaWindowHours
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(__dirname, "..");

  return {
    store,
    abuseConfig,
    app: createApp({
      store,
      abuseConfig,
      distDir: path.join(rootDir, "dist")
    })
  };
}

export async function startServer({ app, store, port = process.env.PORT || 3000 }) {
  await store.init();

  const server = app.listen(port, () => {
    console.log(`Estimator API listening on http://localhost:${port}`);
    console.log(`Estimate storage: ${store.name}`);
  });

  async function shutdown() {
    await store.close();
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

export function isEntrypoint(importMetaUrl, argv = process.argv) {
  return argv[1] && importMetaUrl === pathToFileURL(argv[1]).href;
}
