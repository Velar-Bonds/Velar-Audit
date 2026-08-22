import { config } from '../config.ts'
import { store } from '../store.ts'
import { getPartyWallet } from '../wallet/wdk.ts'
import { hashPayload, newId } from '../attestation/hash.ts'
import type { EvidenceAnchor, EvidenceKind } from '../types.ts'

/**
 * On-chain evidence: hash + timestamp + tx ref.
 *
 * This is the only part of the system a regulator has to trust. Everything else
 * — the database, the dashboard, the compliance verdicts — is a convenience
 * layer that can be rebuilt from these anchors. If the party's server burns
 * down, the chain still says which attestations existed, when, and what they
 * hashed to.
 *
 * What is NOT anchored: anything identifying. Only hashes go on-chain.
 */

export async function anchorEvidence(
  kind: EvidenceKind,
  donationId: string,
  subject: unknown,
): Promise<EvidenceAnchor> {
  const subjectHash = typeof subject === 'string' ? subject : hashPayload(subject)
  const wallet = await getPartyWallet()

  let txRef: string
  let simulated = config.demoMode

  try {
    const result = await wallet.anchor(subjectHash)
    txRef = result.hash
  } catch (err) {
    // An anchor failure must not lose the evidence. Record it as unanchored so
    // the gap is visible in the audit trail rather than silently absent.
    console.warn(`[evidence] anchor failed: ${(err as Error).message}`)
    txRef = 'unanchored'
    simulated = true
  }

  return store.addAnchor({
    id: newId('anc'),
    kind,
    subjectHash,
    donationId,
    anchoredAt: Date.now(),
    txRef,
    chain: config.wdk.chain,
    simulated,
  })
}
