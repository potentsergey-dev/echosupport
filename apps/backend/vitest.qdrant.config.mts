import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.qdrant.integration.test.ts'],
    setupFiles: ['./vitest.integration.setup.mts'],
    testTimeout: 60_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
