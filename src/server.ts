import express from 'express'
import { config } from './config.ts'
import { store } from './store.ts'
import { getPartyWallet } from './wallet/wdk.ts'
import { startIndexer, injectDonation } from './wallet/indexer.ts'
import { issueAttestation } from './attestation/stub-provider.ts'
import { onDonation, onAttestation, scoreDonation, executeReturn, sweepOverdue } from './pipeline.ts'
import { seedDemo } from './demo.ts'

const app = express()
app.use(express.json())
app.use(express.static('web'))

const wrap = (fn: express.RequestHandler): express.RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)

// --- Read ------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, demoMode: config.demoMode, country: config.compliance.country })
})

app.get('/api/wallet', wrap(async (_req, res) => {
  const wallet = await getPartyWallet()
  res.json({
    address: wallet.address,
    chain: config.wdk.chain,
    network: config.wdk.network,
    token: config.wdk.token,
    demoMode: config.demoMode,
  })
}))

/** The dashboard's only data source. */
app.get('/api/audit', (_req, res) => {
  const rows = store.auditRows()
  const counts = { verified: 0, pending: 0, non_compliant: 0, unscored: 0 }
  let totalDecimal = 0

  for (const row of rows) {
    totalDecimal += row.donation.amountDecimal
    if (!row.verdict) counts.unscored++
    else counts[row.verdict.status]++
  }

  res.json({
    rows,
    summary: {
      count: rows.length,
      totalDecimal,
      ...counts,
      policy: {
        country: config.compliance.country,
        donorCapUsd: config.compliance.donorCapUsd,
        cureWindowHours: config.compliance.cureWindowMs / 3_600_000,
      },
    },
  })
})

app.get('/api/anchors', (_req, res) => res.json(store.anchors()))

// --- Write -----------------------------------------------------------------

/** A KYC provider posts an attestation for a donation. */
app.post('/api/attestations', wrap(async (req, res) => {
  const { donationId, donorRef, donorCountry, sourceOfFunds, kycVerified, isPep } = req.body ?? {}
  const donation = store.donation(donationId)
  if (!donation) return res.status(404).json({ error: `unknown donation ${donationId}` })

  const attestation = issueAttestation({
    donation,
    donorRef: donorRef ?? 'donor-unknown',
    donorCountry: donorCountry ?? config.compliance.country,
    sourceOfFunds: sourceOfFunds ?? 'undisclosed',
    kycVerified: kycVerified ?? false,
    isPep: isPep ?? false,
  })

  const verdict = await onAttestation(attestation)
  res.json({ attestation, verdict })
}))

app.post('/api/donations/:id/score', wrap(async (req, res) => {
  res.json(await scoreDonation(String(req.params.id)))
}))

app.post('/api/donations/:id/return', wrap(async (req, res) => {
  res.json(await executeReturn(String(req.params.id)))
}))

app.post('/api/sweep', wrap(async (_req, res) => {
  res.json({ escalated: await sweepOverdue() })
}))

// --- Demo ------------------------------------------------------------------

/** Inject a donation without a chain. Demo mode and rehearsal only. */
app.post('/api/simulate/donation', wrap(async (req, res) => {
  const { amountDecimal, fromAddress } = req.body ?? {}
  if (typeof amountDecimal !== 'number' || typeof fromAddress !== 'string') {
    return res.status(400).json({ error: 'amountDecimal (number) and fromAddress (string) required' })
  }
  const donation = await injectDonation({ amountDecimal, fromAddress }, onDonation)
  res.json({ donation, verdict: store.verdictFor(donation.id) })
}))

/** Load the four-donation demo scenario. Wired to the dashboard's reset button. */
app.post('/api/demo/seed', wrap(async (_req, res) => {
  store.reset()
  res.json(await seedDemo())
}))

// --- Errors ----------------------------------------------------------------

app.use(((err, _req, res, _next) => {
  console.error('[api]', err)
  res.status(500).json({ error: err.message })
}) as express.ErrorRequestHandler)

// --- Boot ------------------------------------------------------------------

app.listen(config.port, async () => {
  console.log(`\n  Testigo — donation auditability`)
  console.log(`  http://localhost:${config.port}`)
  console.log(`  mode: ${config.demoMode ? 'DEMO (simulated chain + rules engine)' : 'LIVE (WDK + QVAC)'}\n`)

  await startIndexer(onDonation)

  // Escalate anything that ages past its cure window.
  setInterval(() => {
    sweepOverdue().catch((err) => console.warn('[sweep]', err.message))
  }, 60_000)
})
