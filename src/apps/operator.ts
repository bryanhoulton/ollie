import { App, ExpressReceiver } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { env } from '../env'
import { logger } from '../logger'
import { findMappingByOperator, getInstallation, touchMapping } from '../db/queries'

export const operatorReceiver = new ExpressReceiver({
  signingSecret: env.operator.signingSecret,
  endpoints: '/slack/operator/events'
})

export const operatorApp = new App({
  token: env.operator.botToken,
  receiver: operatorReceiver
})

operatorApp.message(async ({ message }) => {
  if (message.subtype) return
  if (!('thread_ts' in message) || !message.thread_ts) return
  if (!('user' in message) || !message.user) return
  if ('bot_id' in message && message.bot_id) return // ignore bot posts (headers etc.)
  if (message.user !== env.operator.userId) return // only relay the operator's own replies

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
  const text = 'text' in message ? message.text ?? '' : ''

  await externalClient.chat.postMessage({
    channel: mapping.externalChannelId,
    thread_ts: mapping.externalIsDm ? undefined : mapping.externalThreadTs ?? undefined,
    text,
    unfurl_links: false,
    unfurl_media: false
  })
  await touchMapping(mapping.id)
  logger.info(
    { teamId: mapping.externalTeamId, channel: mapping.externalChannelId },
    'operator reply -> external'
  )
})
