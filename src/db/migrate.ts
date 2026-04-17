import { pool } from './client'
import { logger } from '../logger'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS installations (
  team_id        TEXT PRIMARY KEY,
  team_name      TEXT NOT NULL,
  bot_user_id    TEXT NOT NULL,
  bot_token      TEXT NOT NULL,
  enterprise_id  TEXT,
  installed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reinstalled_at TIMESTAMPTZ,
  disabled_at    TIMESTAMPTZ,
  operator_channel_id TEXT
);

CREATE TABLE IF NOT EXISTS conversation_mappings (
  id                   BIGSERIAL PRIMARY KEY,
  external_team_id     TEXT NOT NULL REFERENCES installations(team_id) ON DELETE CASCADE,
  external_channel_id  TEXT NOT NULL,
  external_thread_ts   TEXT,
  external_is_dm       BOOLEAN NOT NULL,
  operator_channel_id  TEXT NOT NULL,
  operator_thread_ts   TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_mappings_external_idx
  ON conversation_mappings (
    external_team_id,
    external_channel_id,
    COALESCE(external_thread_ts, '')
  );

CREATE INDEX IF NOT EXISTS conversation_mappings_operator_idx
  ON conversation_mappings (operator_channel_id, operator_thread_ts);
`

/** Idempotent. Safe to run on every boot. */
export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL)
  logger.info('migrations applied')
}
