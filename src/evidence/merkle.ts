import { createHash } from 'node:crypto'

/**
 * Merkle tree over evidence hashes.
 *
 * Anchoring every event as its own transaction was measured against live
 * Sepolia at roughly 28 minutes for one seeding run, because transactions from
 * a single account serialise on nonce. Batching the same events under one root
 * brings that to seconds and costs a hundredth of the gas, while each event
 * stays independently provable — a proof is log2(n) sibling hashes, and anyone
 * holding the original payload can check it without this software.
 *
 * Pairs are sorted before hashing, so a proof carries no direction flags. The
 * cost of that is that two leaves sharing a parent commute — swapping them
 * leaves the root unchanged. That is acceptable here: a root commits to the
 * *set* of evidence in a batch and a proof establishes membership in it, so
 * position within the batch carries no meaning and is never relied on.
 *
 * Leaf and internal hashes are domain-separated by a prefix byte, which is what
 * stops an internal node from being passed off as a leaf.
 */

const LEAF_PREFIX = Buffer.from([0x00])
const NODE_PREFIX = Buffer.from([0x01])

function sha256(...parts: Buffer[]): string {
  const h = createHash('sha256')
  for (const part of parts) h.update(part)
  return h.digest('hex')
}

/** Hash a raw evidence hash into a tree leaf. */
export function hashLeaf(evidenceHash: string): string {
  return sha256(LEAF_PREFIX, Buffer.from(evidenceHash, 'hex'))
}

function hashPair(a: string, b: string): string {
  // Sorted so the verifier does not need to know which side each sibling was on.
  const [left, right] = a <= b ? [a, b] : [b, a]
  return sha256(NODE_PREFIX, Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

export interface MerkleTree {
  root: string
  /** Sibling hashes from the leaf up to the root. */
  proofFor(index: number): string[]
  size: number
}

/**
 * Build a tree over already-hashed leaves.
 *
 * An odd node at any level is promoted unchanged rather than paired with
 * itself: duplicating a node lets an attacker present an internal hash as
 * though it were a leaf.
 */
export function buildTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) throw new Error('cannot build a Merkle tree with no leaves')

  const levels: string[][] = [leaves.slice()]

  while (levels[levels.length - 1]!.length > 1) {
    const current = levels[levels.length - 1]!
    const next: string[] = []

    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!
      const right = current[i + 1]
      next.push(right === undefined ? left : hashPair(left, right))
    }
    levels.push(next)
  }

  return {
    root: levels[levels.length - 1]![0]!,
    size: leaves.length,

    proofFor(index: number): string[] {
      if (index < 0 || index >= leaves.length) throw new Error(`leaf ${index} is out of range`)

      const proof: string[] = []
      let position = index

      for (let level = 0; level < levels.length - 1; level++) {
        const nodes = levels[level]!
        const isRight = position % 2 === 1
        const siblingIndex = isRight ? position - 1 : position + 1
        const sibling = nodes[siblingIndex]

        // A promoted odd node has no sibling at this level and contributes
        // nothing to the proof.
        if (sibling !== undefined) proof.push(sibling)
        position = Math.floor(position / 2)
      }

      return proof
    },
  }
}

/** Recompute a root from a leaf and its proof. This is what a verifier runs. */
export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf
  for (const sibling of proof) computed = hashPair(computed, sibling)
  return computed === root
}
