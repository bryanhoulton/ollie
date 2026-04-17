import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: required('PUBLIC_BASE_URL'),

  public: {
    clientId: required('SLACK_PUBLIC_CLIENT_ID'),
    clientSecret: required('SLACK_PUBLIC_CLIENT_SECRET'),
    signingSecret: required('SLACK_PUBLIC_SIGNING_SECRET'),
    stateSecret: required('SLACK_PUBLIC_STATE_SECRET')
  },

  operator: {
    botToken: required('SLACK_OPERATOR_BOT_TOKEN'),
    signingSecret: required('SLACK_OPERATOR_SIGNING_SECRET'),
    appToken: process.env.SLACK_OPERATOR_APP_TOKEN,
    userId: required('SLACK_OPERATOR_USER_ID')
  },

  databaseUrl: required('DATABASE_URL')
} as const
