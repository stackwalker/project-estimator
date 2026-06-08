# Anonymous Estimate Abuse Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add anonymous per-IP burst throttling and durable daily estimate creation quotas for both browser API and MCP save flows.

**Architecture:** Split the current server into focused modules for abuse protection, estimate validation/creation, storage, MCP handling, and app wiring. Use an in-process fixed-window burst limiter before creation routes and store-backed quota reservation inside the shared estimate creation flow. MongoDB stores quota windows in a TTL-managed collection; memory storage mirrors the behavior for local development and tests.

**Tech Stack:** Node.js ESM, Express 5, MongoDB driver, Node built-in `node:test` and `assert`.

---

## File Structure

- Create `server/abuse.js`: config parsing, client IP helpers, rate-limit error type, burst limiter.
- Create `server/estimates.js`: estimate validation and shared creation flow with quota reservation/release.
- Create `server/store.js`: memory and MongoDB stores, including quota reservation APIs.
- Create `server/mcp.js`: MCP JSON-RPC handling and save tool definition.
- Create `server/app.js`: app wiring, routes, middleware, runtime factory, startup/shutdown helpers.
- Rewrite `server/index.js`: thin side-effect-free export plus direct CLI startup.
- Create tests under `server/*.test.js` for limiter, stores, HTTP route behavior, and MCP behavior.
- Modify `package.json`: add a `test` script using Node's built-in test runner.
- Modify `.env.example` and `infra/aws/ecs-express-service.yaml`: document and configure abuse-protection env vars.

## Task 1: Add Abuse Limiter Unit

**Files:**
- Create: `server/abuse.js`
- Test: `server/abuse.test.js`
- Modify: `package.json`

- [x] **Step 1: Add the test script**

Modify `package.json` scripts to include:

```json
"test": "node --test"
```

- [x] **Step 2: Write failing burst limiter tests**

Create `server/abuse.test.js` with tests that import `createBurstLimiter` and `RateLimitError`. Verify requests within the limit are allowed, the next request is rejected with `retryAfterSeconds`, and the window resets after time advances.

- [x] **Step 3: Run tests and verify failure**

Run: `npm test -- server/abuse.test.js`

Expected: FAIL because `server/abuse.js` does not exist.

- [x] **Step 4: Implement `server/abuse.js`**

Export `RateLimitError`, `parseBoolean`, `parsePositiveInteger`, `createAbuseConfig`, `getClientKey`, `createBurstLimiter`, and `formatRetryMessage`.

- [x] **Step 5: Run tests and verify pass**

Run: `npm test -- server/abuse.test.js`

Expected: PASS.

## Task 2: Add Store Quota APIs

**Files:**
- Create: `server/store.js`
- Test: `server/store.test.js`

- [x] **Step 1: Write failing memory store quota tests**

Create `server/store.test.js` with tests for memory estimate save/get, quota allow/reject behavior, quota retry timing, and release after reservation.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -- server/store.test.js`

Expected: FAIL because `server/store.js` does not exist.

- [x] **Step 3: Implement memory store and MongoDB store interfaces**

Create `createMemoryStore`, `createMongoStore`, and `createEstimateStore`. Both stores expose `name`, `quotaBackendName`, `init`, `get`, `save`, `reserveCreateQuota`, `releaseCreateQuota`, and `close`.

- [x] **Step 4: Run tests and verify pass**

Run: `npm test -- server/store.test.js`

Expected: PASS.

## Task 3: Add Shared Estimate Creation Flow

**Files:**
- Create: `server/estimates.js`
- Test: `server/estimates.test.js`

- [x] **Step 1: Write failing creation flow tests**

Create `server/estimates.test.js` with tests for successful save, validation errors before quota consumption, duplicate ID releasing quota, and quota rejection bubbling as `RateLimitError`.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -- server/estimates.test.js`

Expected: FAIL because `server/estimates.js` does not exist.

- [x] **Step 3: Implement estimate validation and creation**

Move existing validation constants/functions into `server/estimates.js`. Export `maxItems`, `maxTitleLength`, `isGuid`, `buildEstimate`, and `createEstimate`.

- [x] **Step 4: Run tests and verify pass**

Run: `npm test -- server/estimates.test.js`

Expected: PASS.

## Task 4: Add MCP Module

**Files:**
- Create: `server/mcp.js`
- Test: `server/mcp.test.js`

- [x] **Step 1: Write failing MCP rate-limit test**

Create `server/mcp.test.js` with tests for `tools/list`, successful `tools/call`, and rate-limited `tools/call` returning `isError: true`.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -- server/mcp.test.js`

Expected: FAIL because `server/mcp.js` does not exist.

- [x] **Step 3: Implement MCP helpers**

Move MCP schema and JSON-RPC handling into `server/mcp.js`, taking a `createEstimate` dependency and passing `clientKey` through tool calls.

- [x] **Step 4: Run tests and verify pass**

Run: `npm test -- server/mcp.test.js`

Expected: PASS.

## Task 5: Wire Express App And HTTP Tests

**Files:**
- Create: `server/app.js`
- Rewrite: `server/index.js`
- Test: `server/app.test.js`

- [x] **Step 1: Write failing HTTP tests**

Create `server/app.test.js` with tests that build the app using memory storage and verify `POST /api/estimates` success, daily quota `429`, duplicate `409`, MCP daily quota tool error, burst quota `429`, and `/health` abuse metadata.

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -- server/app.test.js`

Expected: FAIL because `server/app.js` does not exist.

- [x] **Step 3: Rewrite app wiring**

Create `server/app.js` to export `createApp`, `startServer`, and `createRuntimeFromEnv`. Rewrite `server/index.js` so it only starts listening when the module is run directly. Configure `trust proxy`, burst middleware for creation routes, HTTP errors, MCP request handling, static files, and shutdown.

- [x] **Step 4: Run tests and verify pass**

Run: `npm test -- server/app.test.js`

Expected: PASS.

## Task 6: Add Env Docs And ECS Config

**Files:**
- Modify: `.env.example`
- Modify: `infra/aws/ecs-express-service.yaml`

- [x] **Step 1: Update local env example**

Add the abuse-protection env vars and defaults to `.env.example`.

- [x] **Step 2: Update ECS service env**

Set `TRUST_PROXY=true` and add configurable default limit env vars in `infra/aws/ecs-express-service.yaml`.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands pass.

## Task 7: Final Review

**Files:**
- Review all changed files.

- [ ] **Step 1: Check worktree**

Run: `git status --short`

Expected: only intentional source, test, docs, env, and infra changes.

- [ ] **Step 2: Review diff**

Run: `git diff --stat && git diff --check`

Expected: no whitespace errors and changes match the spec.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add package.json package-lock.json .env.example infra/aws/ecs-express-service.yaml server docs/superpowers/plans/2026-06-08-anonymous-estimate-abuse-protection.md
git commit -m "Add anonymous estimate abuse protection"
```
