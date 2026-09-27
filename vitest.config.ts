import "dotenv/config";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/aides/preparation.ts"],
    // Les tests de base de données partagent une seule base : on les exécute l'un après l'autre.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      SMS_PROVIDER: "simulation",
      SESSION_SECRET: "secret-de-test-uniquement-0123456789abcdef",
    },
  },
});
