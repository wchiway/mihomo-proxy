import { defineConfig } from "vitest/config";

// 独立于 vite.config.ts（那是库构建的 mode 工厂），测试环境零耦合
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
