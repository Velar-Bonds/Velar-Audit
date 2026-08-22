import { config } from './config.js'
import { store } from './store.js'
import { assess } from './compliance/qvac-agent.js'
import { evaluate } from './compliance/rules.js'
import { requestAttestation } from './attestation/stub-provider.js'
import { anchorEvidence } from './evidence/anchor.js'
import { getPartyWallet } from './wallet/wdk.js'
import type { Attestation, ComplianceVerdict, Donation, ReturnAction } from './types.js'

/**
 * The four-step lifecycle, in one place: intake -> evidence -> compliance ->
 * enforcement. Every transition anchors a hash, so the audit trail is written
 * as the work happens rather than reconstructed afterwards.
 */

/** Step 1 + 3: a donation landed. Score it with whatever evidence exists now. */
export async function onDonation(
  donation: Donation,
  opts?: { useAgent?: boolean },
): Promise<ComplianceVerdict> {
  // Ask the provider straight away. It may answer with nothing — that is the
  // `pending` case, and it ages into a violation if the cure window passes.
  const attestation = requestAttestation(donation)
  if (attestation) return onAttestation(attestation, opts)

  return scoreDonation(donation.id, opts)
}

/** Step 2: the KYC provider issued an attestation. Store, anchor, re-score. */
export async function onAttestation(
  attestation: Attestation,
  opts?: { useAgent?: boolean },
): Promise<ComplianceVerdict> {
  store.putAttestation(attestation)
  await anchorEvidence('attestation', attestation.donationId, attestation.hash)
  return scoreDonation(attestation.donationId, opts)
}

/**
 * Step 3: run the compliance agent and anchor the verdict.
 *
 * `useAgent: false` skips the local model and takes the rules verdict directly.
 * Backfilled history uses it — re-running an LLM over months of donations you
 * already judged costs minutes and tells you nothing new.
 */
export async function scoreDonation(
  donationId: string,
  { useAgent = true }: { useAgent?: boolean } = {},
): Promise<ComplianceVerdict> {
  const donation = store.donation(donationId)
  if (!donation) throw new Error(`unknown donation ${donationId}`)

  const ctx = { donation, attestation: store.attestationFor(donationId), now: Date.now() }
  const verdict = useAgent ? await assess(ctx) : evaluate(ctx)

  store.putVerdict(verdict)
  await anchorEvidence('verdict', donationId, {
    status: verdict.status,
    findings: verdict.findings.map((f) => f.code),
    engine: verdict.engine,
    evaluatedAt: verdict.evaluatedAt,
  })

  if (verdict.status === 'non_compliant') flagForReturn(donation, verdict)
  return verdict
}

/** Step 4: a non-compliant donation must go back to where it came from. */
export function flagForReturn(donation: Donation, verdict: ComplianceVerdict): ReturnAction {
  const existing = store.returnFor(donation.id)
  if (existing && existing.status === 'returned') return existing

  const violations = verdict.findings.filter((f) => f.severity === 'violation')
  return store.putReturn({
    donationId: donation.id,
    status: 'flagged',
    reason: violations.map((f) => f.message).join(' '),
    flaggedAt: Date.now(),
    dueBy: Date.now() + config.compliance.cureWindowMs,
    executedAt: null,
    refundTxRef: null,
  })
}

/** Execute the return. The wallet policy permits this only back to the donor. */
export async function executeReturn(donationId: string): Promise<ReturnAction> {
  const donation = store.donation(donationId)
  if (!donation) throw new Error(`unknown donation ${donationId}`)

  const flagged = store.returnFor(donationId)
  if (!flagged) throw new Error(`donation ${donationId} is not flagged for return`)
  if (flagged.status === 'returned') return flagged

  const wallet = await getPartyWallet()
  const { hash } = await wallet.refund(donation.fromAddress, BigInt(donation.amountRaw))

  const done = store.putReturn({
    ...flagged,
    status: 'returned',
    executedAt: Date.now(),
    refundTxRef: hash,
  })

  await anchorEvidence('return', donationId, {
    donationTxHash: donation.txHash,
    refundTxRef: hash,
    reason: done.reason,
    executedAt: done.executedAt,
  })

  console.log(`[return] ${donation.amountDecimal} ${donation.asset} returned to ${donation.fromAddress}`)
  return done
}

/**
 * Escalate anything that sat in `pending` past its cure window. Runs on a timer
 * so a donation cannot quietly age out of scrutiny.
 */
export async function sweepOverdue(): Promise<number> {
  const now = Date.now()
  let escalated = 0

  for (const donation of store.donations()) {
    const verdict = store.verdictFor(donation.id)
    if (!verdict || verdict.status !== 'pending') continue
    if (verdict.cureDeadline === null || now < verdict.cureDeadline) continue

    await scoreDonation(donation.id)
    escalated++
  }

  for (const ret of store.returns()) {
    if (ret.status === 'flagged' && now > ret.dueBy) {
      store.putReturn({ ...ret, status: 'overdue' })
    }
  }

  return escalated
}
