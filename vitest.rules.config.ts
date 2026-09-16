import { defineConfig } from 'vitest/config';

/**
 * The rules suite is separate because it needs the emulator running. It is
 * driven by `npm run test:rules`, which starts one around it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
