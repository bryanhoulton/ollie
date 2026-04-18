import type { WebClient } from '@slack/web-api'
import { logger } from '../logger'

export type SenderIdentity = {
  username: string
  iconUrl: string | undefined
}

/** Fetch display name + avatar for a user in their home workspace. */
export async function resolveIdentity(
  client: WebClient,
  userId: string
): Promise<SenderIdentity> {
  try {
    const info = await client.users.info({ user: userId })
    const user = info.user
    const profile = user?.profile
    return {
      username:
        profile?.display_name ||
        profile?.real_name ||
        user?.real_name ||
        user?.name ||
        userId,
      iconUrl:
        profile?.image_192 ||
        profile?.image_72 ||
        profile?.image_48 ||
        profile?.image_32 ||
        undefined
    }
  } catch (err) {
    logger.warn({ err, userId }, 'failed to resolve user identity')
    return { username: userId, iconUrl: undefined }
  }
}

/**
 * Rewrite `<@UID>` mentions (which render as "Private user info" across
 * workspace boundaries) to plain `@Name` text using users.info lookups.
 */
export async function substituteMentions(client: WebClient, text: string): Promise<string> {
  const re = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g
  const uids = Array.from(new Set(Array.from(text.matchAll(re), (m) => m[1])))
  if (uids.length === 0) return text

  const names = new Map<string, string>()
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const info = await client.users.info({ user: uid })
        names.set(
          uid,
          info.user?.profile?.display_name ||
            info.user?.real_name ||
            info.user?.name ||
            uid
        )
      } catch {
        // leave un-replaced
      }
    })
  )
  return text.replace(re, (_, uid) => `@${names.get(uid) ?? uid}`)
}
