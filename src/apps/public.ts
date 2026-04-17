import { App, ExpressReceiver } from '@slack/bolt'
import { env } from '../env'
import { logger } from '../logger'
import {
  disableInstallation,
  findMappingByExternal,
  getInstallation,
  upsertInstallation
} from '../db/queries'
import { handleInstall, operator as operatorClient } from '../relay/installer'
import { getOrCreateMapping } from '../relay/routing'

export const publicReceiver = new ExpressReceiver({
  signingSecret: env.public.signingSecret,
  clientId: env.public.clientId,
  clientSecret: env.public.clientSecret,
  stateSecret: env.public.stateSecret,
  scopes: [
    'app_mentions:read',
    'channels:history',
    'channels:read',
    'chat:write',
    'groups:history',
    'groups:read',
    'im:history',
    'im:read',
    'im:write',
    'team:read',
    'users:read'
  ],
  installationStore: {
    storeInstallation: async (installation) => {
      await handleInstall(installation)
    },
    fetchInstallation: async (query) => {
      const teamId = query.teamId
      if (!teamId) throw new Error('No teamId in install query')
      const inst = await getInstallation(teamId)
      if (!inst) throw new Error(`No installation for team ${teamId}`)
      // Minimal shape that Bolt needs to authorize incoming events.
      return {
        team: { id: inst.teamId, name: inst.teamName },
        bot: {
          token: inst.botToken,
          userId: inst.botUserId,
          id: inst.botUserId,
          scopes: []
        },
        enterprise: undefined
      } as never
    },
    deleteInstallation: async (query) => {
      if (query.teamId) {
        await disableInstallation(query.teamId)
        logger.info({ teamId: query.teamId }, 'installation disabled via deleteInstallation')
      }
    }
  },
  installerOptions: {
    directInstall: true
  }
})

export const publicApp = new App({ receiver: publicReceiver })

/** Shared guard: fetch install, bail if missing/disabled. */
async function liveInstall(teamId: string | undefined) {
  if (!teamId) return null
  const inst = await getInstallation(teamId)
  if (!inst || inst.disabledAt || !inst.operatorChannelId) return null
  return inst
}

// --- DMs ---------------------------------------------------------------
publicApp.event('message', async ({ event, client, context }) => {
  if (event.subtype) return
  if (event.channel_type !== 'im') return
  if (!('user' in event) || !event.user) return
  if ('bot_id' in event && event.bot_id) return

  const inst = await liveInstall(context.teamId)
  if (!inst) return

  const [userInfo, teamInfo] = await Promise.all([
    client.users.info({ user: event.user }),
    client.team.info()
  ])

  const mapping = await getOrCreateMapping({
    operatorClient,
    operatorChannelId: inst.operatorChannelId!,
    externalTeamId: inst.teamId,
    externalChannelId: event.channel,
    externalThreadTs: null,
    externalIsDm: true,
    headerCtx: {
      teamName: teamInfo.team?.name ?? inst.teamName,
      teamId: inst.teamId,
      userName: userInfo.user?.real_name ?? userInfo.user?.name ?? event.user,
      userId: event.user,
      isDm: true,
      channelId: event.channel
    }
  })

  const text = 'text' in event ? event.text ?? '' : ''
  await operatorClient.chat.postMessage({
    channel: mapping.operatorChannelId,
    thread_ts: mapping.operatorThreadTs,
    text,
    unfurl_links: false,
    unfurl_media: false
  })
  logger.info({ teamId: inst.teamId, channel: event.channel }, 'DM -> operator')
})

// --- @mentions --------------------------------------------------------
publicApp.event('app_mention', async ({ event, client, context }) => {
  const inst = await liveInstall(context.teamId)
  if (!inst) return

  const threadKey = event.thread_ts ?? event.ts

  const [userInfo, teamInfo, channelInfo] = await Promise.all([
    event.user
      ? client.users.info({ user: event.user })
      : Promise.resolve({ user: undefined } as never),
    client.team.info(),
    client.conversations
      .info({ channel: event.channel })
      .catch(() => ({ channel: undefined }))
  ])

  const mapping = await getOrCreateMapping({
    operatorClient,
    operatorChannelId: inst.operatorChannelId!,
    externalTeamId: inst.teamId,
    externalChannelId: event.channel,
    externalThreadTs: threadKey,
    externalIsDm: false,
    headerCtx: {
      teamName: teamInfo.team?.name ?? inst.teamName,
      teamId: inst.teamId,
      userName:
        userInfo.user?.real_name ?? userInfo.user?.name ?? event.user ?? 'unknown',
      userId: event.user ?? 'unknown',
      isDm: false,
      channelId: event.channel,
      channelName: channelInfo.channel?.name
    }
  })

  await operatorClient.chat.postMessage({
    channel: mapping.operatorChannelId,
    thread_ts: mapping.operatorThreadTs,
    text: event.text,
    unfurl_links: false,
    unfurl_media: false
  })
  logger.info({ teamId: inst.teamId, channel: event.channel }, 'mention -> operator')
})

// --- Continued thread replies (after a prior @mention) ----------------
publicApp.message(async ({ message, context }) => {
  if (message.subtype) return
  if (!('thread_ts' in message) || !message.thread_ts) return
  if (!('user' in message) || !message.user) return
  if ('bot_id' in message && message.bot_id) return // ignore bot echoes (including Ollie itself)
  if (message.channel_type === 'im') return

  const inst = await liveInstall(context.teamId)
  if (!inst) return

  // Only relay if a mapping exists, i.e. someone already @mentioned Ollie in this thread.
  const mapping = await findMappingByExternal(inst.teamId, message.channel, message.thread_ts)
  if (!mapping) return

  const text = 'text' in message ? message.text ?? '' : ''
  await operatorClient.chat.postMessage({
    channel: mapping.operatorChannelId,
    thread_ts: mapping.operatorThreadTs,
    text,
    unfurl_links: false,
    unfurl_media: false
  })
  logger.info({ teamId: inst.teamId, channel: message.channel }, 'thread reply -> operator')
})

publicApp.event('app_uninstalled', async ({ context }) => {
  if (!context.teamId) return
  await disableInstallation(context.teamId)
  logger.info({ teamId: context.teamId }, 'app_uninstalled -> disabled')
})
