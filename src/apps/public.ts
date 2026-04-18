import { App, ExpressReceiver } from '@slack/bolt'
import { env } from '../env'
import { logger } from '../logger'
import {
  disableInstallation,
  findMappingByExternal,
  findMessageByExternal,
  getInstallation,
  insertMessageMapping
} from '../db/queries'
import { handleInstall, operator as operatorClient } from '../relay/installer'
import { relayFiles, type SlackFile } from '../relay/files'
import { resolveIdentity, substituteMentions } from '../relay/message'
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
    'files:read',
    'files:write',
    'im:history',
    'im:read',
    'im:write',
    'reactions:read',
    'reactions:write',
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
  installerOptions: { directInstall: true }
})

export const publicApp = new App({ receiver: publicReceiver })

async function liveInstall(teamId: string | undefined) {
  if (!teamId) return null
  const inst = await getInstallation(teamId)
  if (!inst || inst.disabledAt || !inst.operatorChannelId) return null
  return inst
}

// --- DMs ---------------------------------------------------------------
publicApp.event('message', async ({ event, client, context }) => {
  // Allow file_share subtype through; block everything else (edits/joins/etc).
  if (event.subtype && event.subtype !== 'file_share') return
  if (event.channel_type !== 'im') return
  if (!('user' in event) || !event.user) return
  if ('bot_id' in event && event.bot_id) return

  const inst = await liveInstall(context.teamId)
  if (!inst) return

  const rawText = 'text' in event ? event.text ?? '' : ''
  const files = ('files' in event ? (event.files as SlackFile[] | undefined) : undefined) ?? []
  if (!rawText.trim() && files.length === 0) return

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

  const [identity, text] = await Promise.all([
    resolveIdentity(client, event.user),
    substituteMentions(client, rawText)
  ])

  if (text.trim()) {
    const posted = await operatorClient.chat.postMessage({
      channel: mapping.operatorChannelId,
      thread_ts: mapping.operatorThreadTs,
      text,
      username: identity.username,
      icon_url: identity.iconUrl,
      unfurl_links: false,
      unfurl_media: false
    })
    if ('ts' in event && event.ts && posted.ts) {
      await insertMessageMapping({
        mappingId: mapping.id,
        externalTeamId: inst.teamId,
        externalChannelId: event.channel,
        externalTs: event.ts,
        operatorChannelId: mapping.operatorChannelId,
        operatorTs: posted.ts
      })
    }
  }

  if (files.length) {
    await relayFiles({
      srcToken: inst.botToken,
      dst: operatorClient,
      dstChannel: mapping.operatorChannelId,
      dstThreadTs: mapping.operatorThreadTs,
      files
    })
  }

  logger.info(
    { teamId: inst.teamId, channel: event.channel, fileCount: files.length },
    'DM -> operator'
  )
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

  const [identity, text] = await Promise.all([
    event.user
      ? resolveIdentity(client, event.user)
      : Promise.resolve({ username: 'unknown', iconUrl: undefined }),
    substituteMentions(client, event.text ?? '')
  ])
  const files =
    ('files' in event ? (event.files as SlackFile[] | undefined) : undefined) ?? []

  if (text.trim()) {
    const posted = await operatorClient.chat.postMessage({
      channel: mapping.operatorChannelId,
      thread_ts: mapping.operatorThreadTs,
      text,
      username: identity.username,
      icon_url: identity.iconUrl,
      unfurl_links: false,
      unfurl_media: false
    })
    if (event.ts && posted.ts) {
      await insertMessageMapping({
        mappingId: mapping.id,
        externalTeamId: inst.teamId,
        externalChannelId: event.channel,
        externalTs: event.ts,
        operatorChannelId: mapping.operatorChannelId,
        operatorTs: posted.ts
      })
    }
  }

  if (files.length) {
    await relayFiles({
      srcToken: inst.botToken,
      dst: operatorClient,
      dstChannel: mapping.operatorChannelId,
      dstThreadTs: mapping.operatorThreadTs,
      files
    })
  }

  logger.info(
    { teamId: inst.teamId, channel: event.channel, fileCount: files.length },
    'mention -> operator'
  )
})

// --- Continued thread replies (after a prior @mention) ----------------
publicApp.message(async ({ message, client, context }) => {
  if (message.subtype && message.subtype !== 'file_share') return
  if (!('thread_ts' in message) || !message.thread_ts) return
  if (!('user' in message) || !message.user) return
  if ('bot_id' in message && message.bot_id) return
  if (message.channel_type === 'im') return

  const inst = await liveInstall(context.teamId)
  if (!inst) return

  const mapping = await findMappingByExternal(inst.teamId, message.channel, message.thread_ts)
  if (!mapping) return

  const rawText = 'text' in message ? message.text ?? '' : ''
  const files =
    ('files' in message ? (message.files as SlackFile[] | undefined) : undefined) ?? []
  if (!rawText.trim() && files.length === 0) return

  const [identity, text] = await Promise.all([
    resolveIdentity(client, message.user),
    substituteMentions(client, rawText)
  ])

  if (text.trim()) {
    const posted = await operatorClient.chat.postMessage({
      channel: mapping.operatorChannelId,
      thread_ts: mapping.operatorThreadTs,
      text,
      username: identity.username,
      icon_url: identity.iconUrl,
      unfurl_links: false,
      unfurl_media: false
    })
    if ('ts' in message && message.ts && posted.ts) {
      await insertMessageMapping({
        mappingId: mapping.id,
        externalTeamId: inst.teamId,
        externalChannelId: message.channel,
        externalTs: message.ts,
        operatorChannelId: mapping.operatorChannelId,
        operatorTs: posted.ts
      })
    }
  }

  if (files.length) {
    await relayFiles({
      srcToken: inst.botToken,
      dst: operatorClient,
      dstChannel: mapping.operatorChannelId,
      dstThreadTs: mapping.operatorThreadTs,
      files
    })
  }

  logger.info(
    { teamId: inst.teamId, channel: message.channel, fileCount: files.length },
    'thread reply -> operator'
  )
})

// --- Reactions: external -> operator ---------------------------------
publicApp.event('reaction_added', async ({ event, context }) => {
  const inst = await liveInstall(context.teamId)
  if (!inst) return
  if (event.user === inst.botUserId) return // ignore our own bot's reactions
  if (event.item.type !== 'message') return

  const msg = await findMessageByExternal(inst.teamId, event.item.channel, event.item.ts)
  if (!msg) return

  await operatorClient.reactions
    .add({
      channel: msg.operatorChannelId,
      timestamp: msg.operatorTs,
      name: event.reaction
    })
    .catch((err) => {
      if (err?.data?.error === 'already_reacted') return
      logger.warn({ err: err?.data ?? err }, 'failed to mirror reaction external->operator')
    })
})

publicApp.event('reaction_removed', async ({ event, context }) => {
  const inst = await liveInstall(context.teamId)
  if (!inst) return
  if (event.user === inst.botUserId) return
  if (event.item.type !== 'message') return

  const msg = await findMessageByExternal(inst.teamId, event.item.channel, event.item.ts)
  if (!msg) return

  await operatorClient.reactions
    .remove({
      channel: msg.operatorChannelId,
      timestamp: msg.operatorTs,
      name: event.reaction
    })
    .catch((err) => {
      if (err?.data?.error === 'no_reaction') return
      logger.warn({ err: err?.data ?? err }, 'failed to mirror unreact external->operator')
    })
})

publicApp.event('app_uninstalled', async ({ context }) => {
  if (!context.teamId) return
  await disableInstallation(context.teamId)
  logger.info({ teamId: context.teamId }, 'app_uninstalled -> disabled')
})
