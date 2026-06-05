import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 3000;
const estimates = new Map();
const maxItems = 50;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

app.use(express.json({ limit: "256kb" }));

function isGuid(value) {
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

app.get("/api/estimates/:id", (req, res) => {
  const estimate = estimates.get(req.params.id);

  if (!estimate) {
    res.status(404).json({ error: "Estimate not found." });
    return;
  }

  res.json(estimate);
});

app.post("/api/estimates", (req, res) => {
  const id = String(req.body?.id || "");
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!isGuid(id)) {
    res.status(400).json({ error: "A valid estimate GUID is required." });
    return;
  }
  if (estimates.has(id)) {
    res.status(409).json({ error: "This estimate is already saved and cannot be changed." });
    return;
  }
  if (items.length === 0) {
    res.status(400).json({ error: "Add at least one line item before saving." });
    return;
  }
  if (items.length > maxItems) {
    res.status(400).json({ error: `Estimates cannot contain more than ${maxItems} line items.` });
    return;
  }

  try {
    const estimate = {
      id,
      status: "saved",
      createdAt: new Date().toISOString(),
      items: items.map(normalizeItem)
    };

    estimates.set(id, estimate);
    res.status(201).json(estimate);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(express.static(distDir));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Estimator API listening on http://localhost:${port}`);
});
