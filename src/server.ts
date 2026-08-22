import express from 'express'
import QRCode from 'qrcode'
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

/** Identificadores de red para los enlaces de pago EIP-681. */
const CHAIN_IDS: Record<string, number> = {
  sepolia: 11155111, mainnet: 1, arbitrum: 42161, polygon: 137,
}

const app = express()
app.use(express.json())
app.use(authenticate)
/*
 * Always revalidate. The browser happily serves a stale app.css from memory
 * cache, which during a live edit session reads as "my change did nothing".
 * A 304 costs a round trip and nothing else.
 */
app.use(express.static('web', { etag: true, maxAge: 0, setHeaders: (res) => {
  res.setHeader('Cache-Control', 'no-cache')
} }))

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

// --- Público ---------------------------------------------------------------

/*
 * Estos dos endpoints no piden sesión, y no deben pedirla.
 *
 * La dirección de donación de un partido es información pública por
 * definición: si hiciera falta una cuenta para verla, el sistema estaría
 * decidiendo quién puede donar, que es precisamente el papel que no le
 * corresponde. Solo se exponen datos que ya están en la cadena.
 */
app.get('/api/public/parties', wrap(async (_req, res) => {
  const parties = await Promise.all(
    store.parties().map(async (party) => {
      const wallet = await getPartyWallet(party.walletIndex)
      return { id: party.id, name: party.name, code: party.code, address: wallet.address }
    }),
  )
  res.json({
    parties,
    chain: config.wdk.chain,
    network: config.wdk.network,
    token: config.wdk.token,
    demoMode: config.demoMode,
  })
}))

/** QR con un enlace de pago EIP-681, para donar desde el teléfono. */
app.get('/api/public/qr/:partyId.svg', wrap(async (req, res) => {
  const party = store.party(String(req.params.partyId))
  if (!party) return res.status(404).send('Partido desconocido')

  const wallet = await getPartyWallet(party.walletIndex)

  /*
   * EIP-681. Apunta al contrato del token y codifica una llamada a transfer(),
   * de modo que la billetera del donante abra ya rellenada con el destinatario
   * correcto en la red correcta. Sin monto: lo decide quien dona.
   */
  const uri = config.wdk.token.address
    ? `ethereum:${config.wdk.token.address}@${CHAIN_IDS[config.wdk.network] ?? 11155111}/transfer?address=${wallet.address}`
    : `ethereum:${wallet.address}@${CHAIN_IDS[config.wdk.network] ?? 11155111}`

  const svg = await QRCode.toString(uri, {
    type: 'svg', errorCorrectionLevel: 'M', margin: 1,
    color: { dark: '#0c2d4a', light: '#ffffff' },
  })

  res.type('image/svg+xml').setHeader('Cache-Control', 'no-cache')
  res.send(svg)
}))

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
      return {
        partyId: party.id,
        partyName: party.name,
        code: party.code,
        address: wallet.address,
        walletIndex: party.walletIndex,
        balances: await wallet.balances(),
      }
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

/**
 * Evidence certificate for one donation.
 *
 * Built on the server from anchored evidence, so what an observer downloads is
 * the same artefact the tribunal would verify — not a rendering assembled by
 * the browser. It carries no donor identity: a certificate that leaked one
 * would defeat the reason the system hashes anything at all.
 */
app.get('/api/audit/certificate/:id', requireRole('tse'), (req, res) => {
  const donation = store.donation(String(req.params.id))
  if (!donation) return res.status(404).json({ error: 'Unknown donation' })

  const attestation = store.attestationFor(donation.id)
  const verdict = store.verdictFor(donation.id)
  const returnAction = store.returnFor(donation.id)
  const anchors = store.anchorsFor(donation.id)
  const party = store.party(donation.partyId)

  res.json({
    certificate: 'velar-audit-evidence',
    version: 1,
    issuedAt: new Date().toISOString(),

    donation: {
      reference: donation.id,
      party: party?.name ?? donation.partyId,
      amount: donation.amountDecimal,
      asset: donation.asset,
      chain: donation.chain,
      transactionHash: donation.txHash,
      block: donation.blockNumber,
      receivedAt: new Date(donation.receivedAt).toISOString(),
    },

    // Non-identifying fields only. The donor reference is pseudonymous and the
    // hash is what makes the attestation checkable without revealing it.
    attestation: attestation && {
      hash: attestation.hash,
      provider: attestation.providerId,
      donorCountry: attestation.donorCountry,
      sourceOfFunds: attestation.sourceOfFunds,
      identityVerified: attestation.kycVerified,
      issuedAt: new Date(attestation.issuedAt).toISOString(),
    },

    compliance: verdict && {
      status: verdict.status,
      engine: verdict.engine,
      rulesApplied: verdict.findings.map((f) => f.code),
      assessedAt: new Date(verdict.evaluatedAt).toISOString(),
    },

    return: returnAction && {
      status: returnAction.status,
      reason: returnAction.reason,
      refundTransaction: returnAction.refundTxRef,
      executedAt: returnAction.executedAt && new Date(returnAction.executedAt).toISOString(),
    },

    anchors: anchors.map((a) => ({
      kind: a.kind,
      subjectHash: a.subjectHash,
      transaction: a.txRef,
      chain: a.chain,
      anchoredAt: new Date(a.anchoredAt).toISOString(),
      // Never presented as real. An observer must be able to tell a simulated
      // anchor from one a chain actually accepted.
      simulated: a.simulated,
    })),

    verification: {
      note: 'Recompute SHA-256 over the canonical attestation payload and compare '
        + 'it with subjectHash. No personal data is included in this certificate.',
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
