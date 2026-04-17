export type InboundContext = {
  teamName: string
  teamId: string
  userName: string
  userId: string
  isDm: boolean
  channelName?: string
  channelId: string
}

export function formatHeader(ctx: InboundContext): string {
  if (ctx.isDm) {
    return `:inbox_tray: *DM from ${ctx.userName}* (${ctx.teamName} · \`${ctx.teamId}\`)`
  }
  const where = ctx.channelName ? `#${ctx.channelName}` : `\`${ctx.channelId}\``
  return `:inbox_tray: *@mention in ${where}* — ${ctx.userName} (${ctx.teamName} · \`${ctx.teamId}\`)`
}
