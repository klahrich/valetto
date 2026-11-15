import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { testDatabaseOverride } from './test-database';

const MIGRATIONS = './drizzle';

/** Migrates the existing database named by TEST_DATABASE_URL. Nothing to tear down. */
async function migrateServer(url: string): Promise<() => Promise<void>> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migratePostgres(drizzlePostgres(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end();
  }
  process.env.DATABASE_URL = url;
  return async () => {};
}

/**
 * A fresh in-memory PGlite for this run, migrated, then served over the Postgres wire protocol on a free local port.
 * Workers are started after global setup and inherit DATABASE_URL from this process.
 */
async function startPglite(): Promise<() => Promise<void>> {
  const db = new PGlite();
  let server: PGLiteSocketServer | undefined;
  try {
    await migratePglite(drizzlePglite(db), { migrationsFolder: MIGRATIONS });
    // Generous: every postgres client a test opens counts until it closes. PGlite still runs one query at a time.
    server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 100 });
    await server.start();
  } catch (err) {
    await server?.stop().catch(() => {});
    await db.close().catch(() => {});
    throw err;
  }
  // getServerConn() is "127.0.0.1:<port>" once listening on port 0.
  process.env.DATABASE_URL = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;
  const listening = server;
  return async () => {
    await listening.stop();
    await db.close();
  };
}

export default async function setup(): Promise<() => Promise<void>> {
  const override = testDatabaseOverride();
  return override ? migrateServer(override) : startPglite();
}
