import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@ptcg-fight/engine": "/Users/liangshaowen/Documents/ptcg_fight/packages/engine/src/index.ts",
      "@ptcg-fight/cards": "/Users/liangshaowen/Documents/ptcg_fight/packages/cards/src/index.ts"
    }
  }
});
