# Anonymous Estimate Abuse Protection Design

## Context

The estimator app is an unauthenticated Vite and Express application. Users can create immutable estimates through two public creation surfaces:

- `POST /api/estimates`
- `POST /mcp` with the `save_estimate` MCP tool

Both surfaces currently share the same `createEstimate` flow in `server/index.js`. Estimates are stored either in memory for local development or MongoDB in production. Production deployment runs on AWS ECS Express with MongoDB Atlas configured through environment variables.

The application needs to preserve anonymous estimate creation while preventing malicious users from creating too many estimates or flooding the server with rapid requests.

## Goals

- Keep anonymous estimate saving available.
- Limit rapid creation request bursts by anonymous clients.
- Limit sustained estimate creation from one anonymous client to protect MongoDB/storage growth.
- Apply protection consistently to both browser API saves and MCP tool saves.
- Return clear retry errors to legitimate users who hit a limit.
- Keep the first version simple enough for the current small codebase.

## Non-Goals

- Add accounts, login, API keys, or billing.
- Add browser fingerprinting or tracking cookies.
- Restrict reads of existing estimates.
- Build a full admin console for quota inspection.
- Depend only on AWS edge-layer throttling.

## Recommended Approach

Use a hybrid design:

- An in-process per-IP burst limiter rejects rapid floods before expensive work.
- A MongoDB-backed per-IP daily save quota enforces durable storage protection across ECS tasks and restarts.

This gives fast local protection for request spikes while making the storage quota reliable in production, where ECS may run more than one task.

## Configuration

Add environment variables with conservative defaults:

- `TRUST_PROXY=false`
- `ESTIMATE_BURST_LIMIT=20`
- `ESTIMATE_BURST_WINDOW_SECONDS=60`
- `ESTIMATE_DAILY_CREATE_LIMIT=25`
- `ESTIMATE_QUOTA_WINDOW_HOURS=24`
- `MONGODB_QUOTA_COLLECTION=estimate_quotas`

The ECS service template should set `TRUST_PROXY=true` so Express can derive the original client IP from forwarded headers supplied by the ECS Express proxy layer.

Abuse protection should be enabled by default. A future escape hatch can be added if operational experience shows it is needed, but the first version should avoid a config path that accidentally disables protection in production.

## Client Identity

Anonymous clients are identified by normalized IP address.

Express should call `app.set("trust proxy", true)` only when `TRUST_PROXY=true`. Rate limiting then uses `req.ip`.

When `TRUST_PROXY=false`, local development and direct server access use the direct socket IP. The first version will not use cookies or browser fingerprinting. IP-based anonymous quotas are imperfect, especially for shared networks, but they match the current unauthenticated product model without adding new identity systems.

## Enforcement Points

Protect only creation paths:

- `POST /api/estimates`
- `POST /mcp`

Do not rate-limit static assets, health checks, or `GET /api/estimates/:id` in the first version.

Enforcement should happen in two layers:

1. Express middleware checks the in-process burst limiter before the create handlers run. Rejected HTTP requests return `429`.
2. The shared estimate creation flow checks the durable daily create quota before the estimate is saved.

The durable quota check must be in the shared create path, not only in the HTTP route, so MCP saves and browser saves get the same policy.

## Store Design

The estimate store should expose quota operations so memory and MongoDB storage can each implement the behavior that fits the backend.

Recommended interface additions:

- `reserveCreateQuota(clientKey, now)`
- `releaseCreateQuota(reservation)`

For memory storage, quota documents can live in an in-memory map. This is acceptable for local development and tests.

For MongoDB storage, use a separate collection named by `MONGODB_QUOTA_COLLECTION`. Each document represents one client and one quota window:

- `_id`: stable key combining normalized client IP and window start
- `clientKey`
- `windowStart`
- `expiresAt`
- `count`

MongoDB should have a TTL index on `expiresAt` so old quota documents are removed automatically. It should also have an index on `clientKey` and `windowStart` if needed for diagnostics.

The reservation operation should atomically increment the count only when the current count is below `ESTIMATE_DAILY_CREATE_LIMIT`. If the limit is exceeded, it returns a rate-limit result with `retryAfterSeconds`.

If a quota reservation succeeds but the estimate insert later fails because the estimate ID already exists, the flow must release the reservation. Duplicate immutable save attempts should continue returning `409` and should not permanently consume daily quota.

## Save Flow

For both API and MCP saves:

1. Determine the client IP key from the request.
2. Apply the in-process burst limiter.
3. Validate and normalize the estimate payload.
4. Reserve daily create quota for the client key.
5. Insert the immutable estimate.
6. If insert fails because the estimate already exists, release the quota reservation and return the existing duplicate error.
7. Return the saved estimate or MCP tool result.

Validation should remain before durable quota reservation where possible, so obviously invalid payloads do not consume daily save quota. The burst limiter still applies before validation to reduce CPU pressure from floods.

## Error Behavior

For `POST /api/estimates`, rate-limited responses should use HTTP `429`:

```json
{
  "error": "Too many estimate saves. Try again later.",
  "retryAfterSeconds": 3600
}
```

Set the `Retry-After` response header when the retry delay is known.

For MCP `save_estimate`, return an MCP tool error:

- `isError: true`
- text content with a concise rate-limit message and retry timing

Existing error behavior should remain:

- Validation errors: `400`
- Duplicate immutable estimate ID: `409`
- Successful creation: `201`

The React app can keep using its existing save message area. No new UI flow is required for the first version.

## Observability

Log rate-limit rejections with:

- limit type: burst or daily quota
- normalized client key
- route or surface
- retry delay

Do not log estimate titles, line item descriptions, or full request bodies.

Extend `/health` with static abuse-protection metadata:

- whether trust proxy is enabled
- burst limiter enabled/configured
- quota backend name

Do not expose live per-IP counts in `/health`.

## Code Organization

The current `server/index.js` holds routing, estimate validation, storage, MCP handling, and process startup. The abuse protection feature should make a targeted split so the new policy code remains testable:

- app/server wiring
- estimate validation and creation flow
- estimate store implementations
- abuse limiter and quota helpers
- MCP tool handling

This is not a broad refactor. The split should serve only the abuse-protection implementation and its tests.

## Tests

Add focused Node tests for:

- in-process burst limiter allows requests within the window
- in-process burst limiter rejects requests over the window and reports retry timing
- Mongo-style quota logic allows saves below the daily limit
- quota logic rejects saves above the daily limit
- duplicate estimate IDs release quota reservations
- `POST /api/estimates` returns `429` and `retryAfterSeconds` when daily quota is exceeded
- MCP `save_estimate` returns an MCP tool error when daily quota is exceeded

If a test runner is introduced, prefer Node's built-in `node:test` and `assert` modules to keep dependencies small unless the implementation needs a stronger HTTP test harness.

## Open Implementation Notes

- The exact default limits can be tuned after production use, but the initial values should be configurable from environment variables.
- IP-based anonymous limits may affect shared networks. The user-facing error should be plain and include retry timing.
- AWS edge throttling can be added later as defense in depth, but app-side quota enforcement remains necessary for accepted estimate creation counts.
