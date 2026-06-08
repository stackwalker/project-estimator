import { RateLimitError } from "./abuse.js";

export const maxItems = 50;
export const maxTitleLength = 80;

export function isGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeItem(item, index) {
  const description = String(item.description || "").trim();
  const estimate = Number(item.estimate);
  const metric = String(item.metric || "");
  const confidence = Number(item.confidence);

  if (!description) {
    throw new Error(`Line ${index + 1} needs a description.`);
  }
  if (!Number.isFinite(estimate) || estimate < 0) {
    throw new Error(`Line ${index + 1} needs a non-negative estimate.`);
  }
  if (!["hours", "days", "weeks"].includes(metric)) {
    throw new Error(`Line ${index + 1} needs a valid time metric.`);
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error(`Line ${index + 1} needs confidence from 0 to 100.`);
  }

  return {
    id: String(item.id || crypto.randomUUID()),
    description,
    estimate,
    metric,
    confidence
  };
}

function normalizeTitle(value) {
  const title = String(value || "").trim();

  if (!title) {
    throw new Error("Estimate title is required.");
  }
  if (title.length > maxTitleLength) {
    throw new Error(`Estimate title cannot be longer than ${maxTitleLength} characters.`);
  }

  return title;
}

export function buildEstimate(payload, now = new Date()) {
  const id = String(payload?.id || crypto.randomUUID());
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!isGuid(id)) {
    throw new Error("A valid estimate GUID is required.");
  }
  if (items.length === 0) {
    throw new Error("Add at least one line item before saving.");
  }
  if (items.length > maxItems) {
    throw new Error(`Estimates cannot contain more than ${maxItems} line items.`);
  }

  return {
    id,
    title: normalizeTitle(payload?.title),
    status: "saved",
    createdAt: now.toISOString(),
    items: items.map(normalizeItem)
  };
}

export async function createEstimate({ payload, store, clientKey, now = new Date() }) {
  const estimate = buildEstimate(payload, now);
  const quota = await store.reserveCreateQuota(clientKey, now);

  if (!quota.allowed) {
    throw new RateLimitError("Too many estimate saves.", {
      limitType: quota.limitType,
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  try {
    const saved = await store.save(estimate);

    if (!saved) {
      await store.releaseCreateQuota(quota.reservation);
      throw new Error("This estimate is already saved and cannot be changed.");
    }

    return estimate;
  } catch (error) {
    if (error.message !== "This estimate is already saved and cannot be changed.") {
      await store.releaseCreateQuota(quota.reservation);
    }
    throw error;
  }
}
