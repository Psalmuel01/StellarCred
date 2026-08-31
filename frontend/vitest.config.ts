import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    // Standalone publish-only packages (issuer, sdk, etc.) run their own
    // vitest suites from their own directories / environments — don't pull
    // them into the app runner, where the jsdom environment would break
    // server-only packages like @stellarcred/issuer.
    exclude: ["**/node_modules/**", "**/dist/**", "packages/**"],
    setupFiles: ["./test/setup.ts"],
  },
});