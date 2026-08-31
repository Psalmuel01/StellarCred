// The issuer package is server-only and runs its suite in a plain Node
// environment. This file stops it from inheriting the app workspace's jsdom
// vitest.config.ts (discovered by walking up the directory tree), which would
// otherwise make the suite fail because @stellarcred/issuer refuses to load
// when a `window` global exists.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});