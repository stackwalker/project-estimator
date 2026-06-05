import express from "express";
import { MongoClient } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 3000;
const maxItems = 50;
const maxTitleLength = 80;
const mcpProtocolVersion = "2025-06-18";
const storageDriver = (process.env.ESTIMATE_STORE || (process.env.MONGODB_URI ? "mongodb" : "memory")).toLowerCase();
const mongoUri = process.env.MONGODB_URI;
const mongoDatabase = process.env.MONGODB_DB || "estimator";
const mongoCollection = process.env.MONGODB_COLLECTION || "estimates";
const deploymentMarker = "github-actions-validation-2026-06-05";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    storage: estimateStore.name,
    marker: deploymentMarker
  });
});

function publicEstimate(document) {
  if (!document) return null;
  const { _id, ...estimate } = document;
  return estimate;
}

function createMemoryStore() {
  const estimates = new Map();

  return {
    name: "memory",
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
    async close() {}
  };
}

function createMongoStore() {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required when ESTIMATE_STORE=mongodb.");
  }

  const client = new MongoClient(mongoUri);
  let collection;

  return {
    name: "mongodb",
    async init() {
      await client.connect();
      collection = client.db(mongoDatabase).collection(mongoCollection);
    },
    async get(id) {
      const document = await collection.findOne({ _id: id });
      return publicEstimate(document);
    },
    async save(estimate) {
      try {
        await collection.insertOne({ _id: estimate.id, ...estimate });
        return true;
      } catch (error) {
        if (error.code === 11000) {
          return false;
        }

        throw error;
      }
    },
    async close() {
      await client.close();
    }
  };
}

function createEstimateStore() {
  if (storageDriver === "memory") {
    return createMemoryStore();
  }
  if (storageDriver === "mongodb") {
    return createMongoStore();
  }

  throw new Error(`Unsupported ESTIMATE_STORE value: ${storageDriver}`);
}

const estimateStore = createEstimateStore();

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

function buildEstimate(payload) {
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

  const estimate = {
    id,
    title: normalizeTitle(payload?.title),
    status: "saved",
    createdAt: new Date().toISOString(),
    items: items.map(normalizeItem)
  };

  return estimate;
}

async function createEstimate(payload) {
  const estimate = buildEstimate(payload);
  const saved = await estimateStore.save(estimate);

  if (!saved) {
    throw new Error("This estimate is already saved and cannot be changed.");
  }

  return estimate;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data }
  };
}

function textContent(text) {
  return [{ type: "text", text }];
}

const saveEstimateTool = {
  name: "save_estimate",
  title: "Save estimate",
  description: "Save an immutable project estimate with a title and line-item work estimates.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "items"],
    properties: {
      id: {
        type: "string",
        description: "Optional estimate GUID. If omitted, the server generates one."
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: maxTitleLength,
        description: "Human-readable estimate title."
      },
      items: {
        type: "array",
        minItems: 1,
        maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "estimate", "metric", "confidence"],
          properties: {
            id: {
              type: "string",
              description: "Optional line-item identifier. If omitted, the server generates one."
            },
            description: {
              type: "string",
              minLength: 1,
              description: "Description of the scoped work."
            },
            estimate: {
              type: "number",
              minimum: 0,
              description: "Non-negative numeric estimate."
            },
            metric: {
              type: "string",
              enum: ["hours", "days", "weeks"],
              description: "Time metric for the estimate value."
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Confidence percentage from 0 to 100."
            }
          }
        }
      }
    }
  },
  outputSchema: {
    type: "object",
    additionalProperties: true,
    properties: {
      estimate: { type: "object" }
    }
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }
};

async function callMcpTool(params = {}) {
  if (params.name !== saveEstimateTool.name) {
    return jsonRpcError(null, -32602, `Unknown tool: ${params.name || "<missing>"}`);
  }

  try {
    const estimate = await createEstimate(params.arguments || {});

    return {
      content: textContent(`Saved estimate "${estimate.title}" with ${estimate.items.length} line item(s).`),
      structuredContent: { estimate }
    };
  } catch (error) {
    return {
      content: textContent(error.message),
      isError: true
    };
  }
}

async function handleMcpRequest(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return jsonRpcError(message?.id ?? null, -32600, "Invalid JSON-RPC request.");
  }

  if (message.id === undefined) {
    return null;
  }

  if (message.method === "initialize") {
    return jsonRpcResult(message.id, {
      protocolVersion: mcpProtocolVersion,
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: "estimator",
        version: "0.1.0"
      },
      instructions:
        "Use tools/list to discover tools. Use save_estimate to save immutable project estimates."
    });
  }

  if (message.method === "tools/list") {
    return jsonRpcResult(message.id, {
      tools: [saveEstimateTool]
    });
  }

  if (message.method === "tools/call") {
    const result = await callMcpTool(message.params);
    if (result.error) {
      return { ...result, id: message.id };
    }
    return jsonRpcResult(message.id, result);
  }

  if (message.method === "ping") {
    return jsonRpcResult(message.id, {});
  }

  return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

app.get("/api/estimates/:id", async (req, res) => {
  const estimate = await estimateStore.get(req.params.id);

  if (!estimate) {
    res.status(404).json({ error: "Estimate not found." });
    return;
  }

  res.json(estimate);
});

app.post("/api/estimates", async (req, res) => {
  try {
    const estimate = await createEstimate(req.body);
    res.status(201).json(estimate);
  } catch (error) {
    const status = error.message.includes("already saved") ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
});

app.post("/mcp", async (req, res) => {
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const responses = (await Promise.all(messages.map(handleMcpRequest))).filter(Boolean);

  if (responses.length === 0) {
    res.status(204).send();
    return;
  }

  res.type("application/json").json(Array.isArray(req.body) ? responses : responses[0]);
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    error: "This MCP server supports JSON-RPC requests over HTTP POST at /mcp."
  });
});

app.use(express.static(distDir));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

await estimateStore.init();

const server = app.listen(port, () => {
  console.log(`Estimator API listening on http://localhost:${port}`);
  console.log(`Estimate storage: ${estimateStore.name}`);
});

async function shutdown() {
  await estimateStore.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
