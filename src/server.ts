import { config } from './config.js'
import app, { bootstrap } from './app.js'
import { startIndexer } from './wallet/indexer.js'
import { onDonation, sweepOverdue } from './pipeline.js'

/**
 * Local entry point. The long-running pieces — the chain indexer and the
 * overdue sweep — live here rather than in app.ts, because a serverless host
 * has no process to run them in.
 */
app.listen(config.port, async () => {
  console.log(`\n  Velar Audit — donation auditability`)
  console.log(`  http://localhost:${config.port}`)
  console.log(`  chain: ${config.wdk.network} (id ${config.wdk.chainId})\n`)

  await bootstrap()
  await startIndexer(onDonation)

  setInterval(() => {
    sweepOverdue().catch((err) => console.warn('[sweep]', err.message))
  }, 60_000)
})
