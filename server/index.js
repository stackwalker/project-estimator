import { createRuntimeFromEnv, isEntrypoint, startServer } from "./app.js";

export { createApp, createRuntimeFromEnv, startServer } from "./app.js";

if (isEntrypoint(import.meta.url)) {
  const runtime = createRuntimeFromEnv();
  await startServer(runtime);
}
