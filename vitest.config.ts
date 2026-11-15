import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { TEST_BACKEND_ENV, testBackend } from './tests/test-database';

// DATABASE_URL is set by tests/global-setup.ts: a fresh in-process PGlite per run, or TEST_DATABASE_URL when set.
// Drop any DATABASE_URL from the shell so a test worker can never reach a real database by accident.
delete process.env.DATABASE_URL;
// Fixtures only. They decrypt data and sign unsubscribe links in the test suite, not production secrets.
const TEST_ENCRYPTION_KEY = 'mhcGYy/QQSaUWHD/IIlKtlSADRzkjC+s70BxMUduK2w=';
const TEST_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      [TEST_BACKEND_ENV]: testBackend(),
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      CRON_SECRET: 'test-cron-secret',
      UNSUBSCRIBE_SECRET: TEST_UNSUBSCRIBE_SECRET,
      VALETTO_ALLOW_PRIVATE_WEBHOOKS: '1',
      VALETTO_NO_AUTO_UPDATE: '1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
