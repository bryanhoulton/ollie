import type { Installation } from '@slack/oauth'
import { WebClient } from '@slack/web-api'
import { env } from '../env'
import { logger } from '../logger'
import { upsertInstallation, setOperatorChannel, getInstallation } from '../db/queries'

const operatorClient = new WebClient(env.operator.botToken)

/**
 * Called by Bolt's InstallProvider after OAuth success. Persists the token,
 * provisions a dedicated channel in the operator workspace, and welcomes the op.
 */
export async function handleInstall(installation: Installation): Promise<void> {
  const teamId = installation.team?.id
  const teamName = installation.team?.name ?? 'unknown'
  const botToken = installation.bot?.token
  const botUserId = installation.bot?.userId
  if (!teamId || !botToken || !botUserId) {
    throw new Error('Install payload missing team/bot info')
  }

  await upsertInstallation({
    teamId,
    teamName,
    botUserId,
    botToken,
    enterpriseId: installation.enterprise?.id ?? null
  })

  const existing = await getInstallation(teamId)
  if (!existing?.operatorChannelId) {
    const channelId = await provisionOperatorChannel(teamId, teamName)
    await setOperatorChannel(teamId, channelId)
    logger.info({ teamId, teamName, channelId }, 'provisioned operator channel')
  } else {
    logger.info({ teamId, teamName }, 'reused existing operator channel')
  }
}

async function provisionOperatorChannel(teamId: string, teamName: string): Promise<string> {
  const slug = slugify(teamName).slice(0, 50)
  const name = `ollie-${slug}-${teamId.slice(-4).toLowerCase()}`

  const created = await operatorClient.conversations.create({ name, is_private: false })
  const channelId = created.channel?.id
  if (!channelId) throw new Error('Failed to create operator channel')

  await operatorClient.conversations.invite({ channel: channelId, users: env.operator.userId })
  await operatorClient.chat.postMessage({
    channel: channelId,
    text: `:wave: Ollie was installed into *${teamName}* (\`${teamId}\`). Replies in this channel's threads will be relayed back.`
  })
  return channelId
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const operator = operatorClient
