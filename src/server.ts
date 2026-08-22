import express from 'express'
import { config } from './config.ts'
import { store } from './store.ts'
import { getPartyWallet } from './wallet/wdk.ts'
import { startIndexer, injectDonation } from './wallet/indexer.ts'
import { issueAttestation } from './attestation/stub-provider.ts'
import { onDonation, onAttestation, scoreDonation, executeReturn, sweepOverdue } from './pipeline.ts'
import { seedDemo } from './demo.ts'
import { seedIdentity } from './seed.ts'
import { authRouter } from './auth/routes.ts'
import { authenticate, requireAuth, requireRole, scopeFor, toSafeUser } from './auth/middleware.ts'
import type { AuthedRequest } from './auth/middleware.ts'

const app = express()
app.use(express.json())
app.use(authenticate)
app.use(express.static('web'))

const wrap = (fn: express.RequestHandler): express.RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)

/**
 * A `partido` user may only touch its own donations.
 *
 * Without this, party scoping would be a filter on the list endpoint and
 * nothing more — Alfa could still act on Beta's donations by guessing an id.
 * Returns the donation when access is allowed, and answers the request itself
 * when it is not.
 */
function donationForUser(req: AuthedRequest, res: express.Response, id: string) {
  const donation = store.donation(id)
  if (!donation) {
    res.status(404).json({ error: `Donación desconocida: ${id}` })
    return null
  }
  const scope = scopeFor(req.user!)
  if (scope !== null && donation.partyId !== scope) {
    // 404 rather than 403: whether another party received a given donation is
    // itself information this user is not entitled to.
    res.status(404).json({ error: `Donación desconocida: ${id}` })
    return null
  }
  return donation
}

// --- Auth ------------------------------------------------------------------

app.use('/api/auth', authRouter)

// --- Read ------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, demoMode: config.demoMode, country: config.compliance.country })
})

app.get('/api/parties', requireAuth, (req: AuthedRequest, res) => {
  const scope = scopeFor(req.user!)
  const parties = store.parties().filter((p) => scope === null || p.id === scope)
  res.json(parties)
})

app.get('/api/wallet', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const scope = scopeFor(req.user!)
  const parties = store.parties().filter((p) => scope === null || p.id === scope)

  const walletsByParty = await Promise.all(
    parties.map(async (party) => {
      const wallet = await getPartyWallet(party.walletIndex)
      return { partyId: party.id, partyName: party.name, code: party.code, address: wallet.address }
    }),
  )

  res.json({
    wallets: walletsByParty,
    chain: config.wdk.chain,
    network: config.wdk.network,
    token: config.wdk.token,
    demoMode: config.demoMode,
  })
}))

/** The dashboard's only data source. Scoped to whoever is asking. */
app.get('/api/audit', requireAuth, (req: AuthedRequest, res) => {
  const rows = store.auditRows(scopeFor(req.user!))
  const counts = { verified: 0, pending: 0, non_compliant: 0, unscored: 0 }
  let totalDecimal = 0

  for (const row of rows) {
    totalDecimal += row.donation.amountDecimal
    if (!row.verdict) counts.unscored++
    else counts[row.verdict.status]++
  }

  res.json({
    rows,
    parties: Object.fromEntries(store.parties().map((p) => [p.id, p.name])),
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

/** The full evidence trail. The TSE audits across every party. */
app.get('/api/anchors', requireRole('tse'), (_req, res) => res.json(store.anchors()))

// --- Write -----------------------------------------------------------------

/** A KYC provider posts an attestation for a donation. */
app.post('/api/attestations', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const { donationId, donorRef, donorCountry, sourceOfFunds, kycVerified, isPep } = req.body ?? {}
  const donation = donationForUser(req, res, String(donationId))
  if (!donation) return

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

app.post('/api/donations/:id/score', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const donation = donationForUser(req, res, String(req.params.id))
  if (!donation) return
  res.json(await scoreDonation(donation.id))
}))

app.post('/api/donations/:id/return', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const donation = donationForUser(req, res, String(req.params.id))
  if (!donation) return
  res.json(await executeReturn(donation.id))
}))

app.post('/api/sweep', requireRole('tse'), wrap(async (_req, res) => {
  res.json({ escalated: await sweepOverdue() })
}))

// --- Demo ------------------------------------------------------------------

/** Inject a donation without a chain. Demo mode and rehearsal only. */
app.post('/api/simulate/donation', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const { amountDecimal, fromAddress } = req.body ?? {}
  if (typeof amountDecimal !== 'number' || typeof fromAddress !== 'string') {
    return res.status(400).json({ error: 'amountDecimal (number) y fromAddress (string) requeridos' })
  }

  // A party may only simulate donations to itself; the TSE picks a party.
  const scope = scopeFor(req.user!)
  const partyId = scope ?? String(req.body?.partyId ?? store.parties()[0]?.id ?? '')
  if (!store.party(partyId)) return res.status(400).json({ error: `Partido desconocido: ${partyId}` })

  const donation = await injectDonation({ amountDecimal, fromAddress, partyId }, onDonation)
  res.json({ donation, verdict: store.verdictFor(donation.id) })
}))

/** Reload the demo scenario. Wipes the ledger, so the TSE role only. */
app.post('/api/demo/seed', requireRole('tse'), wrap(async (_req, res) => {
  store.reset()
  await seedIdentity()
  res.json(await seedDemo())
}))

// --- Errors ----------------------------------------------------------------

app.use(((err, _req, res, _next) => {
  console.error('[api]', err)
  res.status(500).json({ error: err.message })
}) as express.ErrorRequestHandler)

// --- Boot ------------------------------------------------------------------

app.listen(config.port, async () => {
  console.log(`\n  Velar Audit — auditoría de donaciones`)
  console.log(`  http://localhost:${config.port}`)
  console.log(`  modo: ${config.demoMode ? 'DEMO (cadena simulada + motor de reglas)' : 'REAL (WDK + QVAC)'}\n`)

  await seedIdentity()
  await startIndexer(onDonation)

  // Escalate anything that ages past its cure window.
  setInterval(() => {
    sweepOverdue().catch((err) => console.warn('[sweep]', err.message))
  }, 60_000)
})
