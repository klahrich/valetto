/**
 * Where the test suite's database lives.
 *
 * By default each `vitest run` starts its own in-process Postgres (PGlite, see tests/global-setup.ts), migrated from
 * `drizzle/` and served on a free 127.0.0.1 port, so the app and the tests talk to it through `postgres` exactly as
 * they would to a real server. No database server is needed.
 *
 * Set TEST_DATABASE_URL to run against an existing database on a real Postgres server instead. That database is
 * migrated but never created or dropped. Only then do the tests that need several truly concurrent sessions (row
 * locks held across connections, races between connections) run; see `realPostgres`.
 */

/** Set by vitest.config.ts so workers can tell which backend the run uses. */
export const TEST_BACKEND_ENV = 'VALETTO_TEST_DB_BACKEND';

export type TestBackend = 'pglite' | 'server';

export function testDatabaseOverride(): string | null {
  return process.env.TEST_DATABASE_URL?.trim() || null;
}

export function testBackend(): TestBackend {
  const set = process.env[TEST_BACKEND_ENV];
  if (set === 'pglite' || set === 'server') return set;
  return testDatabaseOverride() ? 'server' : 'pglite';
}

/**
 * True when the run uses a real Postgres server (TEST_DATABASE_URL). PGlite is one session: the socket server
 * multiplexes connections onto it and runs one transaction at a time, so a test that holds a lock on one connection
 * while another waits on it, or that races statements across connections, cannot run there. Gate those tests with
 * `describe.runIf(realPostgres)` / `it.runIf(realPostgres)`.
 */
export const realPostgres = testBackend() === 'server';
