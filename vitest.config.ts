import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    hookTimeout: 20000,
    fileParallelism: false,
    // The env module runs `export const env = parseEnv()` at import time against
    // process.env; provide a valid APP_URL so importing it in tests does not throw.
    env: { APP_URL: 'http://localhost:3000' },
  },
});
