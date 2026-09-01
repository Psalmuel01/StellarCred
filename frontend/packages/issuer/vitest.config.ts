import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Issuer tests run in Node (no browser API needed).
    environment: "node",
  },
});
