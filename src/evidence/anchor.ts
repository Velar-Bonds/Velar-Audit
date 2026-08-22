import { config } from '../config.js'
import { store } from '../store.js'
import { getPartyWallet } from '../wallet/wdk.js'
import { hashPayload, newId } from '../attestation/hash.js'
import { buildTree, hashLeaf } from './merkle.js'
import type { EvidenceAnchor, EvidenceKind } from '../types.js'

/**
 * On-chain evidence, anchored in batches.
 *
 * This is the only part of the system a regulator has to trust. The database,
 * the dashboard and the verdicts are a convenience layer that can be rebuilt
 * from these anchors; if the party's server burns down, the chain still says
 * which attestations existed, when, and what they hashed to.
 *
 * Queueing rather than sending immediately is what makes single-chain operation
 * usable: transactions from one account serialise on nonce, so anchoring every
 * event on its own put a block interval between each verdict and turned a
 * seeding run into half an hour of waiting. One root per batch collapses that
 * to a single transaction while leaving each event independently provable.
 *
 * What is never anchored: anything identifying. Only hashes go on-chain.
 */

/** Record the evidence and queue it. Returns immediately — no transaction yet. */
export async function anchorEvidence(
  kind: EvidenceKind,
  donationId: string,
  subject: unknown,
): Promise<EvidenceAnchor> {
  const donation = store.donation(donationId)
  if (!donation) throw new Error(`cannot anchor evidence for unknown donation ${donationId}`)

  const subjectHash = typeof subject === 'string' ? subject : hashPayload(subject)

  return store.addAnchor({
    id: newId('anc'),
    kind,
    subjectHash,
    leafHash: hashLeaf(subjectHash),
    donationId,
    partyId: donation.partyId,
    queuedAt: Date.now(),
    status: 'pending',
    anchoredAt: null,
    merkleRoot: null,
    merkleProof: null,
    txRef: null,
    chain: config.wdk.chain,
  })
}

/** Is this party's queue due to be sealed? */
export function batchIsDue(partyId: string): boolean {
  const pending = store.pendingAnchors(partyId)
  if (pending.length === 0) return false
  if (pending.length >= config.evidence.batchSize) return true

  const oldest = Math.min(...pending.map((a) => a.queuedAt))
  return Date.now() - oldest >= config.evidence.batchMaxAgeMs
}

/**
 * Seal one party's pending evidence under a single root.
 *
 * Sealed per party, by that party's own wallet. Anchoring every party's
 * evidence from one wallet would put the record of what Beta received inside
 * Alfa's transaction history, which is neither self-custody nor separation.
 */
export async function sealBatch(partyId: string): Promise<{ root: string; txRef: string } | null> {
  const pending = store.pendingAnchors(partyId)
  if (pending.length === 0) return null

  const party = store.party(partyId)
  if (!party) throw new Error(`unknown party ${partyId}`)

  const tree = buildTree(pending.map((a) => a.leafHash))
  const wallet = await getPartyWallet(party.walletIndex)

  let txRef: string
  try {
    const result = await wallet.anchor(tree.root)
    txRef = result.hash
  } catch (err) {
    // Mark the batch failed rather than losing it. The evidence stays in the
    // record with a visible gap, and the next seal can retry.
    console.warn(`[evidence] sealing ${party.code} failed: ${(err as Error).message}`)
    for (const anchor of pending) store.updateAnchor(anchor.id, { status: 'failed' })
    return null
  }

  const anchoredAt = Date.now()
  pending.forEach((anchor, index) => {
    store.updateAnchor(anchor.id, {
      status: 'anchored',
      anchoredAt,
      merkleRoot: tree.root,
      merkleProof: tree.proofFor(index),
      txRef,
    })
  })

  console.log(`[evidence] ${party.code}: ${pending.length} items anchored under ${tree.root.slice(0, 12)}… in ${txRef}`)
  return { root: tree.root, txRef }
}

/** Seal every party whose queue is due. Returns how many batches were written. */
export async function sealDueBatches(): Promise<number> {
  let sealed = 0
  for (const party of store.parties()) {
    if (!batchIsDue(party.id)) continue
    const result = await sealBatch(party.id)
    if (result) sealed++
  }
  return sealed
}

/** Seal everything outstanding, whether or not it is due. Used by the sync action. */
export async function sealAll(): Promise<number> {
  let sealed = 0
  for (const party of store.parties()) {
    const result = await sealBatch(party.id)
    if (result) sealed++
  }
  return sealed
}
