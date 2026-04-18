import { App, ExpressReceiver } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { env } from '../env'
import { logger } from '../logger'
import {
  findMappingByOperator,
  findMessageByOperator,
  getInstallation,
  insertMessageMapping,
  touchMapping
} from '../db/queries'
import { substituteMentions } from '../relay/message'

const operatorSelfClient = new WebClient(env.operator.botToken)

export const operatorReceiver = new ExpressReceiver({
  signingSecret: env.operator.signingSecret,
  endpoints: '/slack/operator/events'
})

export const operatorApp = new App({
  token: env.operator.botToken,
  receiver: operatorReceiver
})

// --- Operator reply -> external workspace -----------------------------
operatorApp.message(async ({ message }) => {
  if (message.subtype) return
  if (!('thread_ts' in message) || !message.thread_ts) return
  if (!('user' in message) || !message.user) return
  if ('bot_id' in message && message.bot_id) return
  if (message.user !== env.operator.userId) return

  const mapping = await findMappingByOperator(message.channel, message.thread_ts)
  if (!mapping) return

  const inst = await getInstallation(mapping.externalTeamId)
  if (!inst || inst.disabledAt) {
    logger.warn(
      { teamId: mapping.externalTeamId },
      'install missing/disabled, dropping operator reply'
    )
    return
  }

  const externalClient = new WebClient(inst.botToken)
  const rawText = 'text' in message ? message.text ?? '' : ''
  // Resolve mentions against the operator's own workspace before posting to external
  // (those UIDs don't exist in the external team and would render as "Private user info").
  const text = await substituteMentions(operatorSelfClient, rawText)

  const posted = await externalClient.chat.postMessage({
    channel: mapping.externalChannelId,
    thread_ts: mapping.externalIsDm ? undefined : mapping.externalThreadTs ?? undefined,
    text,
    unfurl_links: false,
    unfurl_media: false
  })
  if ('ts' in message && message.ts && posted.ts) {
    await insertMessageMapping({
      mappingId: mapping.id,
      externalTeamId: mapping.externalTeamId,
      externalChannelId: mapping.externalChannelId,
      externalTs: posted.ts,
      operatorChannelId: message.channel,
      operatorTs: message.ts
    })
  }
  await touchMapping(mapping.id)
  logger.info(
    { teamId: mapping.externalTeamId, channel: mapping.externalChannelId },
    'operator reply -> external'
  )
})

// --- Operator reaction -> external workspace --------------------------
operatorApp.event('reaction_added', async ({ event }) => {
  if (event.user !== env.operator.userId) return
  if (event.item.type !== 'message') return

  const msg = await findMessageByOperator(event.item.channel, event.item.ts)
  if (!msg) return

  const inst = await getInstallation(msg.externalTeamId)
  if (!inst || inst.disabledAt) return

  const externalClient = new WebClient(inst.botToken)
  await externalClient.reactions
    .add({
      channel: msg.externalChannelId,
      timestamp: msg.externalTs,
      name: event.reaction
    })
    .catch((err) => {
      if (err?.data?.error === 'already_reacted') return
      logger.warn({ err: err?.data ?? err }, 'failed to mirror reaction operator->external')
    })
})

operatorApp.event('reaction_removed', async ({ event }) => {
  if (event.user !== env.operator.userId) return
  if (event.item.type !== 'message') return

  const msg = await findMessageByOperator(event.item.channel, event.item.ts)
  if (!msg) return

  const inst = await getInstallation(msg.externalTeamId)
  if (!inst || inst.disabledAt) return

  const externalClient = new WebClient(inst.botToken)
  await externalClient.reactions
    .remove({
      channel: msg.externalChannelId,
      timestamp: msg.externalTs,
      name: event.reaction
    })
    .catch((err) => {
      if (err?.data?.error === 'no_reaction') return
      logger.warn({ err: err?.data ?? err }, 'failed to mirror unreact operator->external')
    })
})
