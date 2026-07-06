import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only look for tests in src, never in the compiled dist/ output
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['dist/**', 'node_modules/**', 'src/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/typings/**', 'src/db/seed.ts'],
      thresholds: {
        statements: 15,
        branches: 8,
        functions: 18,
        lines: 15,
      },
    },
  },
});
