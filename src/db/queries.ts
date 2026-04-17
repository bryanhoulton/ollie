import { pool } from './client'

export type Installation = {
  teamId: string
  teamName: string
  botUserId: string
  botToken: string
  operatorChannelId: string | null
  disabledAt: Date | null
}

export type Mapping = {
  id: number
  externalTeamId: string
  externalChannelId: string
  externalThreadTs: string | null
  externalIsDm: boolean
  operatorChannelId: string
  operatorThreadTs: string
}

export async function upsertInstallation(row: {
  teamId: string
  teamName: string
  botUserId: string
  botToken: string
  enterpriseId: string | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO installations (team_id, team_name, bot_user_id, bot_token, enterprise_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (team_id) DO UPDATE
       SET team_name = EXCLUDED.team_name,
           bot_user_id = EXCLUDED.bot_user_id,
           bot_token = EXCLUDED.bot_token,
           enterprise_id = EXCLUDED.enterprise_id,
           reinstalled_at = NOW(),
           disabled_at = NULL`,
    [row.teamId, row.teamName, row.botUserId, row.botToken, row.enterpriseId]
  )
}

export async function setOperatorChannel(teamId: string, channelId: string): Promise<void> {
  await pool.query(
    `UPDATE installations SET operator_channel_id = $1 WHERE team_id = $2`,
    [channelId, teamId]
  )
}

export async function disableInstallation(teamId: string): Promise<void> {
  await pool.query(
    `UPDATE installations SET disabled_at = NOW() WHERE team_id = $1`,
    [teamId]
  )
}

export async function getInstallation(teamId: string): Promise<Installation | null> {
  const { rows } = await pool.query(
    `SELECT team_id, team_name, bot_user_id, bot_token, operator_channel_id, disabled_at
     FROM installations WHERE team_id = $1`,
    [teamId]
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    teamId: r.team_id,
    teamName: r.team_name,
    botUserId: r.bot_user_id,
    botToken: r.bot_token,
    operatorChannelId: r.operator_channel_id,
    disabledAt: r.disabled_at
  }
}

export async function findMappingByExternal(
  teamId: string,
  channelId: string,
  threadTs: string | null
): Promise<Mapping | null> {
  const { rows } = await pool.query(
    `SELECT * FROM conversation_mappings
     WHERE external_team_id = $1
       AND external_channel_id = $2
       AND COALESCE(external_thread_ts, '') = COALESCE($3, '')
     LIMIT 1`,
    [teamId, channelId, threadTs]
  )
  return rows[0] ? rowToMapping(rows[0]) : null
}

export async function findMappingByOperator(
  operatorChannelId: string,
  operatorThreadTs: string
): Promise<Mapping | null> {
  const { rows } = await pool.query(
    `SELECT * FROM conversation_mappings
     WHERE operator_channel_id = $1 AND operator_thread_ts = $2
     LIMIT 1`,
    [operatorChannelId, operatorThreadTs]
  )
  return rows[0] ? rowToMapping(rows[0]) : null
}

export async function insertMapping(row: {
  externalTeamId: string
  externalChannelId: string
  externalThreadTs: string | null
  externalIsDm: boolean
  operatorChannelId: string
  operatorThreadTs: string
}): Promise<Mapping> {
  const { rows } = await pool.query(
    `INSERT INTO conversation_mappings
      (external_team_id, external_channel_id, external_thread_ts, external_is_dm,
       operator_channel_id, operator_thread_ts)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      row.externalTeamId,
      row.externalChannelId,
      row.externalThreadTs,
      row.externalIsDm,
      row.operatorChannelId,
      row.operatorThreadTs
    ]
  )
  return rowToMapping(rows[0])
}

export async function touchMapping(id: number): Promise<void> {
  await pool.query(`UPDATE conversation_mappings SET last_activity_at = NOW() WHERE id = $1`, [id])
}

function rowToMapping(r: Record<string, unknown>): Mapping {
  return {
    id: Number(r.id),
    externalTeamId: r.external_team_id as string,
    externalChannelId: r.external_channel_id as string,
    externalThreadTs: (r.external_thread_ts as string | null) ?? null,
    externalIsDm: r.external_is_dm as boolean,
    operatorChannelId: r.operator_channel_id as string,
    operatorThreadTs: r.operator_thread_ts as string
  }
}
