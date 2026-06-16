import { Pool } from 'pg';
import type { DatabaseStatus } from './types';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false },
    });
  }

  return pool;
}

export async function checkDatabaseStatus(): Promise<DatabaseStatus> {
  const checkedAt = new Date().toISOString();

  try {
    await getPool().query('SELECT 1');
    return {
      ok: true,
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      message: getDatabaseErrorMessage(error),
    };
  }
}

function getDatabaseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'PostgreSQL is unavailable.';
}

let migrated = false;

/**
 * Run schema migration. Safe to call multiple times (idempotent).
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;

  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS services (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      url         TEXT,
      status      VARCHAR(20) NOT NULL DEFAULT 'operational',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE services ADD COLUMN IF NOT EXISTS expected_status_code INTEGER NOT NULL DEFAULT 200;

    CREATE TABLE IF NOT EXISTS health_checks (
      id            SERIAL PRIMARY KEY,
      service_id    INTEGER REFERENCES services(id) ON DELETE CASCADE,
      status        VARCHAR(20) NOT NULL,
      response_time INTEGER,
      status_code   INTEGER,
      url           TEXT,
      checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_health_checks_service_checked
      ON health_checks (service_id, checked_at DESC);

    CREATE TABLE IF NOT EXISTS incidents (
      id          SERIAL PRIMARY KEY,
      service_id  INTEGER REFERENCES services(id) ON DELETE CASCADE,
      title       VARCHAR(200) NOT NULL,
      message     TEXT NOT NULL,
      severity    VARCHAR(20) NOT NULL,
      status      VARCHAR(20) NOT NULL DEFAULT 'investigating',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_service
      ON incidents (service_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_incidents_active
      ON incidents (status, created_at DESC)
      WHERE status != 'resolved';

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      keys       JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  migrated = true;
}
