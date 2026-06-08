import { RateLimitError, formatRetryMessage } from "./abuse.js";
import { maxItems, maxTitleLength } from "./estimates.js";

const mcpProtocolVersion = "2025-06-18";

export function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data }
  };
}

export function textContent(text) {
  return [{ type: "text", text }];
}

export const saveEstimateTool = {
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

export function createMcpHandler({ createEstimate }) {
  async function callMcpTool({ params = {}, clientKey }) {
    if (params.name !== saveEstimateTool.name) {
      return jsonRpcError(null, -32602, `Unknown tool: ${params.name || "<missing>"}`);
    }

    try {
      const estimate = await createEstimate({ payload: params.arguments || {}, clientKey });

      return {
        content: textContent(`Saved estimate "${estimate.title}" with ${estimate.items.length} line item(s).`),
        structuredContent: { estimate }
      };
    } catch (error) {
      return {
        content: textContent(error instanceof RateLimitError ? formatRetryMessage(error) : error.message),
        isError: true
      };
    }
  }

  return async function handleMcpRequest({ message, clientKey }) {
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
      const result = await callMcpTool({ params: message.params, clientKey });
      if (result.error) {
        return { ...result, id: message.id };
      }
      return jsonRpcResult(message.id, result);
    }

    if (message.method === "ping") {
      return jsonRpcResult(message.id, {});
    }

    return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  };
}
