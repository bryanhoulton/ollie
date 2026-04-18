import type { WebClient } from '@slack/web-api'
import { logger } from '../logger'

/** Hard cap on a single file we'll attempt to proxy. Render Starter is 512MB RAM. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export type SlackFile = {
  id: string
  name?: string
  title?: string
  mimetype?: string
  url_private?: string
  url_private_download?: string
  size?: number
  mode?: string
  filetype?: string
  permalink?: string
}

type RelayArgs = {
  /** Bot token that can read the source files. */
  srcToken: string
  /** Destination WebClient with files:write scope. */
  dst: WebClient
  dstChannel: string
  /** Optional thread to anchor uploads to. */
  dstThreadTs?: string
  files: SlackFile[]
}

/**
 * Downloads each file from the source workspace using its auth'd URL, then
 * reuploads via files.uploadV2 on the destination workspace. Oversized files
 * produce a placeholder message instead.
 */
export async function relayFiles({
  srcToken,
  dst,
  dstChannel,
  dstThreadTs,
  files
}: RelayArgs): Promise<void> {
  for (const f of files) {
    try {
      if (!f || f.mode === 'tombstone' || f.mode === 'hidden_by_limit') continue

      const size = f.size ?? 0
      if (size > MAX_FILE_BYTES) {
        await dst.chat.postMessage({
          channel: dstChannel,
          thread_ts: dstThreadTs,
          text: `_[file \`${f.name ?? 'upload'}\` too large to relay: ${(size / 1024 / 1024).toFixed(1)} MB]_`,
          unfurl_links: false,
          unfurl_media: false
        })
        continue
      }

      const url = f.url_private_download || f.url_private
      if (!url) {
        logger.warn({ fileId: f.id }, 'file has no private URL, skipping')
        continue
      }

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${srcToken}` },
        redirect: 'follow'
      })
      if (!resp.ok) {
        throw new Error(`file download ${resp.status} ${resp.statusText}`)
      }
      const buf = Buffer.from(await resp.arrayBuffer())

      // Cast because FilesUploadV2Arguments types require thread_ts as string,
      // but Slack accepts it as optional at runtime.
      await dst.filesUploadV2({
        channel_id: dstChannel,
        thread_ts: dstThreadTs as string,
        file: buf,
        filename: f.name ?? `file-${f.id}`,
        title: f.title ?? f.name ?? undefined
      })
    } catch (err) {
      logger.warn(
        { err: (err as { message?: string })?.message ?? err, fileId: f.id },
        'failed to relay file'
      )
      // Best-effort notification so the operator knows something was attached.
      await dst.chat
        .postMessage({
          channel: dstChannel,
          thread_ts: dstThreadTs,
          text: `_[failed to relay file \`${f.name ?? f.id}\`]_`,
          unfurl_links: false,
          unfurl_media: false
        })
        .catch(() => {})
    }
  }
}
