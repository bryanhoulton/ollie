import { pino } from 'pino'
import { env } from './env'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.nodeEnv === 'production' ? 'info' : 'debug'),
  transport:
    env.nodeEnv === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' }
        }
})
