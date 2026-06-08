import { MongoClient } from "mongodb";

function publicEstimate(document) {
  if (!document) return null;
  const { _id, ...estimate } = document;
  return estimate;
}

function createWindow(now, quotaWindowHours) {
  const windowMs = quotaWindowHours * 60 * 60 * 1000;
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const windowStartMs = Math.floor(time / windowMs) * windowMs;
  const expiresAtMs = windowStartMs + windowMs;

  return {
    windowStart: new Date(windowStartMs),
    expiresAt: new Date(expiresAtMs),
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - time) / 1000))
  };
}

function quotaId(clientKey, windowStart) {
  return `${clientKey}:${windowStart.toISOString()}`;
}

export function createMemoryStore({ dailyCreateLimit = 25, quotaWindowHours = 24 } = {}) {
  const estimates = new Map();
  const quotas = new Map();

  return {
    name: "memory",
    quotaBackendName: "memory",
    async init() {},
    async get(id) {
      return estimates.get(id) || null;
    },
    async save(estimate) {
      if (estimates.has(estimate.id)) {
        return false;
      }

      estimates.set(estimate.id, estimate);
      return true;
    },
    async reserveCreateQuota(clientKey, now = new Date()) {
      const window = createWindow(now, quotaWindowHours);
      const id = quotaId(clientKey, window.windowStart);
      const current = quotas.get(id);

      if (!current || current.expiresAt <= now) {
        const next = {
          id,
          clientKey,
          windowStart: window.windowStart,
          expiresAt: window.expiresAt,
          count: 1
        };
        quotas.set(id, next);
        return { allowed: true, reservation: { id } };
      }

      if (current.count >= dailyCreateLimit) {
        return {
          allowed: false,
          limitType: "daily",
          retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000))
        };
      }

      current.count += 1;
      return { allowed: true, reservation: { id } };
    },
    async releaseCreateQuota(reservation) {
      if (!reservation?.id) return;
      const current = quotas.get(reservation.id);
      if (!current) return;
      current.count = Math.max(0, current.count - 1);
    },
    async close() {}
  };
}

export function createMongoStore({
  mongoUri,
  mongoDatabase = "estimator",
  mongoCollection = "estimates",
  mongoQuotaCollection = "estimate_quotas",
  dailyCreateLimit = 25,
  quotaWindowHours = 24
} = {}) {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required when ESTIMATE_STORE=mongodb.");
  }

  const client = new MongoClient(mongoUri);
  let estimates;
  let quotas;

  return {
    name: "mongodb",
    quotaBackendName: "mongodb",
    async init() {
      await client.connect();
      const db = client.db(mongoDatabase);
      estimates = db.collection(mongoCollection);
      quotas = db.collection(mongoQuotaCollection);
      await quotas.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await quotas.createIndex({ clientKey: 1, windowStart: 1 });
    },
    async get(id) {
      const document = await estimates.findOne({ _id: id });
      return publicEstimate(document);
    },
    async save(estimate) {
      try {
        await estimates.insertOne({ _id: estimate.id, ...estimate });
        return true;
      } catch (error) {
        if (error.code === 11000) {
          return false;
        }

        throw error;
      }
    },
    async reserveCreateQuota(clientKey, now = new Date()) {
      const window = createWindow(now, quotaWindowHours);
      const id = quotaId(clientKey, window.windowStart);

      try {
        const updated = await quotas.findOneAndUpdate(
          {
            _id: id,
            $or: [{ count: { $lt: dailyCreateLimit } }, { count: { $exists: false } }]
          },
          {
            $setOnInsert: {
              _id: id,
              clientKey,
              windowStart: window.windowStart,
              expiresAt: window.expiresAt
            },
            $inc: { count: 1 }
          },
          {
            upsert: true,
            returnDocument: "after"
          }
        );

        if (updated) {
          return { allowed: true, reservation: { id } };
        }
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }

      const current = await quotas.findOne({ _id: id });
      const retryAfterSeconds = current?.expiresAt
        ? Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000))
        : window.retryAfterSeconds;

      return { allowed: false, limitType: "daily", retryAfterSeconds };
    },
    async releaseCreateQuota(reservation) {
      if (!reservation?.id) return;
      await quotas.updateOne({ _id: reservation.id, count: { $gt: 0 } }, { $inc: { count: -1 } });
    },
    async close() {
      await client.close();
    }
  };
}

export function createEstimateStore({
  storageDriver = "memory",
  mongoUri,
  mongoDatabase,
  mongoCollection,
  mongoQuotaCollection,
  dailyCreateLimit,
  quotaWindowHours
} = {}) {
  if (storageDriver === "memory") {
    return createMemoryStore({ dailyCreateLimit, quotaWindowHours });
  }
  if (storageDriver === "mongodb") {
    return createMongoStore({
      mongoUri,
      mongoDatabase,
      mongoCollection,
      mongoQuotaCollection,
      dailyCreateLimit,
      quotaWindowHours
    });
  }

  throw new Error(`Unsupported ESTIMATE_STORE value: ${storageDriver}`);
}
