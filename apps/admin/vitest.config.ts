import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/vitest.setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts'],
      thresholds: {
        statements: 1,
        branches: 1,
        functions: 1,
        lines: 1,
      },
    },
  },
});
