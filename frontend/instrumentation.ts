// Runs once, before the server accepts its first request (see
// experimental.instrumentationHook in next.config.mjs). Importing lib/env.ts
// here is what makes environment validation happen at genuine startup — dev
// or prod — instead of lazily whenever a route first reads a given key.
export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./lib/env");
    }
  }