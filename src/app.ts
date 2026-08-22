import express from 'express'
import QRCode from 'qrcode'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/*
 * Resolve the static directory from this module rather than from the working
 * directory. A serverless host does not run the process from the repository
 * root, and express.static('web') silently serves nothing when it is wrong.
 */
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
import { config } from './config.js'
import { store } from './store.js'
import { getPartyWallet } from './wallet/wdk.js'
import { onDonation, onAttestation, scoreDonation, executeReturn, sweepOverdue } from './pipeline.js'
import { seedIdentity } from './seed.js'
import { authRouter } from './auth/routes.js'
import { authenticate, requireAuth, requireRole, scopeFor, toSafeUser } from './auth/middleware.js'
import { syncNow, syncIfStale } from './sync.js'
import type { AuthedRequest } from './auth/middleware.js'

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
app.use(express.static(WEB_DIR, { etag: true, maxAge: 0, setHeaders: (res) => {
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
    chainId: config.wdk.chainId,
    explorerUrl: config.wdk.explorerUrl,
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
  res.json({
    ok: true,
    country: config.compliance.country,
    chain: config.wdk.chain,
    network: config.wdk.network,
    chainId: config.wdk.chainId,
  })
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
    chainId: config.wdk.chainId,
    explorerUrl: config.wdk.explorerUrl,
  })
}))

/** The dashboard's only data source. Scoped to whoever is asking. */
app.get('/api/audit', requireAuth, wrap(async (req: AuthedRequest, res) => {
  // Requests are what drive the indexer on a host with no background process.
  await syncIfStale()

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
}))

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
      status: a.status,
      subjectHash: a.subjectHash,
      leafHash: a.leafHash,
      merkleRoot: a.merkleRoot,
      merkleProof: a.merkleProof,
      transaction: a.txRef,
      chain: a.chain,
      network: config.wdk.network,
      anchoredAt: a.anchoredAt ? new Date(a.anchoredAt).toISOString() : null,
    })),

    /**
     * Everything needed to check this certificate without running this software.
     * The point of publishing the procedure is that a regulator should not have
     * to take the system's word for its own evidence.
     */
    verification: {
      steps: [
        'Recompute SHA-256 over the canonical attestation payload to obtain subjectHash.',
        'Compute leafHash = SHA-256(0x00 || subjectHash) to lift it into a tree leaf.',
        'Fold the merkleProof into the leaf: at each step sort the pair, then compute '
          + 'SHA-256(0x01 || left || right). The result must equal merkleRoot.',
        'Read the transaction on the block explorer and confirm its calldata carries '
          + 'that same merkleRoot.',
      ],
      explorer: `${config.wdk.explorerUrl}/tx/`,
      note: 'No personal data is included in this certificate. Anchors still marked '
        + 'pending have been recorded but their batch has not been sealed yet.',
    },
  })
})

/** The full evidence trail. The TSE audits across every party. */
app.get('/api/anchors', requireRole('tse'), (_req, res) => res.json(store.anchors()))

// --- Write -----------------------------------------------------------------

/*
 * There is deliberately no endpoint for posting an attestation.
 *
 * Attestations arrive from the provider when a donation is indexed. Letting a
 * party submit its own would mean the audited writing its own evidence, which
 * is the one thing this system exists to prevent.
 */

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

// --- Sync ------------------------------------------------------------------

/**
 * Pull the chain and seal outstanding evidence, on demand.
 *
 * Serverless has no background process to hold a polling interval, so the
 * indexer is driven by requests instead. Exposed as an action so an operator
 * can force it during a demonstration rather than waiting for the next call.
 */
app.post('/api/sync', requireAuth, wrap(async (_req, res) => {
  res.json(await syncNow())
}))

// --- Errors ----------------------------------------------------------------

app.use(((err, _req, res, _next) => {
  console.error('[api]', err)
  res.status(500).json({ error: err.message })
}) as express.ErrorRequestHandler)

/**
 * Bring the instance up to a usable state.
 *
 * On a serverless host every cold start begins with an empty store, so the
 * demonstration data is seeded on boot rather than only on request. Without it
 * a judge opening the public URL would be met with an empty dashboard and no
 * way to fill it.
 */
/**
 * Bring the instance up to a usable state.
 *
 * A cold start begins with an empty store, so the first request replays the
 * chain rather than serving a blank dashboard. That the state can be rebuilt
 * from the chain alone is the system's central claim; here it is simply how it
 * starts up.
 */
export async function bootstrap(): Promise<void> {
  await seedIdentity()
  await syncIfStale({ force: true })
}

export default app
