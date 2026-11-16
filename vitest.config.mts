import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { env: { PUSH_DISABLED: "1" }, testTimeout: 60000, hookTimeout: 120000, pool: "forks", fileParallelism: false },
  resolve: { alias: { "@": import.meta.dirname } },
});
