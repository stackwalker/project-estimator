import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitError } from "./abuse.js";
import { createMcpHandler, saveEstimateTool } from "./mcp.js";

test("MCP tools/list returns the save estimate tool", async () => {
  const handleMcpRequest = createMcpHandler({
    createEstimate: async () => {
      throw new Error("not used");
    }
  });

  const response = await handleMcpRequest({
    message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    clientKey: "ip:127.0.0.1"
  });

  assert.equal(response.result.tools[0].name, saveEstimateTool.name);
});

test("MCP tools/call saves an estimate with the client key", async () => {
  let seenClientKey = "";
  const handleMcpRequest = createMcpHandler({
    createEstimate: async ({ clientKey }) => {
      seenClientKey = clientKey;
      return { title: "Project", items: [{ id: "line-1" }] };
    }
  });

  const response = await handleMcpRequest({
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "save_estimate", arguments: { title: "Project", items: [] } }
    },
    clientKey: "ip:127.0.0.1"
  });

  assert.equal(seenClientKey, "ip:127.0.0.1");
  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.estimate.title, "Project");
});

test("MCP tools/call returns a tool error when rate limited", async () => {
  const handleMcpRequest = createMcpHandler({
    createEstimate: async () => {
      throw new RateLimitError("Too many estimate saves.", {
        limitType: "daily",
        retryAfterSeconds: 60
      });
    }
  });

  const response = await handleMcpRequest({
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "save_estimate", arguments: { title: "Project", items: [] } }
    },
    clientKey: "ip:127.0.0.1"
  });

  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /Try again in 60 seconds/);
});
