export class RateLimitError extends Error {
  constructor(message, { limitType, retryAfterSeconds }) {
    super(message);
    this.name = "RateLimitError";
    this.limitType = limitType;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return defaultValue;
}

export function parsePositiveInteger(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function createAbuseConfig(env = process.env) {
  return {
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    burstLimit: parsePositiveInteger(env.ESTIMATE_BURST_LIMIT, 20),
    burstWindowSeconds: parsePositiveInteger(env.ESTIMATE_BURST_WINDOW_SECONDS, 60),
    dailyCreateLimit: parsePositiveInteger(env.ESTIMATE_DAILY_CREATE_LIMIT, 25),
    quotaWindowHours: parsePositiveInteger(env.ESTIMATE_QUOTA_WINDOW_HOURS, 24),
    mongoQuotaCollection: String(env.MONGODB_QUOTA_COLLECTION || "estimate_quotas")
  };
}

export function normalizeIpAddress(value) {
  const ip = String(value || "unknown").trim() || "unknown";
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

export function getClientKey(req) {
  return `ip:${normalizeIpAddress(req?.ip || req?.socket?.remoteAddress)}`;
}

export function createBurstLimiter({ limit, windowSeconds }) {
  const windows = new Map();
  const windowMs = windowSeconds * 1000;

  return {
    check(clientKey, now = Date.now()) {
      const current = windows.get(clientKey);

      if (!current || now >= current.windowStart + windowMs) {
        windows.set(clientKey, { windowStart: now, count: 1 });
        return { allowed: true };
      }

      if (current.count >= limit) {
        return {
          allowed: false,
          limitType: "burst",
          retryAfterSeconds: Math.ceil((current.windowStart + windowMs - now) / 1000)
        };
      }

      current.count += 1;
      return { allowed: true };
    }
  };
}

export function formatRetryMessage(error) {
  const retryAfterSeconds = Math.max(1, Number(error.retryAfterSeconds) || 1);
  return `${error.message} Try again in ${retryAfterSeconds} seconds.`;
}
