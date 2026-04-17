import { env } from './env'
import { logger } from './logger'
import { publicApp, publicReceiver } from './apps/public'
import { operatorApp, operatorReceiver } from './apps/operator'

async function main() {
  // Mount both Bolt receivers on a single Express server.
  // publicReceiver owns the HTTP server; operatorReceiver's router is mounted into it.
  const expressApp = publicReceiver.app
  expressApp.use(operatorReceiver.router)

  expressApp.get('/healthz', (_req, res) => res.status(200).send('ok'))
  expressApp.get('/', (_req, res) => res.redirect('/slack/install'))

  // Starting only the public app binds the port once; both receivers share it.
  await publicApp.start(env.port)

  // Wire the operator app handlers without starting a second listener.
  // (operatorApp is constructed with operatorReceiver, so event routing is already live.)
  void operatorApp

  logger.info({ port: env.port, url: env.publicBaseUrl }, 'ollie listening')
}

main().catch((err) => {
  logger.fatal({ err }, 'ollie failed to boot')
  process.exit(1)
})
