import type { WebClient } from '@slack/web-api'
import {
  findMappingByExternal,
  insertMapping,
  touchMapping,
  type Mapping
} from '../db/queries'
import { formatHeader, type InboundContext } from './format'

/**
 * Gets or creates a mapping for an incoming external event, posting the header
 * as a new top-level message in the operator channel if needed.
 */
export async function getOrCreateMapping(args: {
  operatorClient: WebClient
  operatorChannelId: string
  externalTeamId: string
  externalChannelId: string
  externalThreadTs: string | null
  externalIsDm: boolean
  headerCtx: InboundContext
}): Promise<Mapping> {
  const existing = await findMappingByExternal(
    args.externalTeamId,
    args.externalChannelId,
    args.externalThreadTs
  )
  if (existing) {
    await touchMapping(existing.id)
    return existing
  }

  const header = await args.operatorClient.chat.postMessage({
    channel: args.operatorChannelId,
    text: formatHeader(args.headerCtx),
    unfurl_links: false,
    unfurl_media: false
  })
  if (!header.ts) throw new Error('operator postMessage returned no ts')

  return insertMapping({
    externalTeamId: args.externalTeamId,
    externalChannelId: args.externalChannelId,
    externalThreadTs: args.externalThreadTs,
    externalIsDm: args.externalIsDm,
    operatorChannelId: args.operatorChannelId,
    operatorThreadTs: header.ts
  })
}
