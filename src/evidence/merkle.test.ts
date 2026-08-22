import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildTree, hashLeaf, verifyProof } from './merkle.js'

const h = (s: string) => createHash('sha256').update(s).digest('hex')

test('every leaf in a four-leaf tree proves to the root', () => {
  const leaves = ['a', 'b', 'c', 'd'].map((x) => hashLeaf(h(x)))
  const tree = buildTree(leaves)

  assert.equal(tree.size, 4)
  for (const [i, leaf] of leaves.entries()) {
    assert.ok(verifyProof(leaf, tree.proofFor(i), tree.root), `leaf ${i} failed`)
    assert.equal(tree.proofFor(i).length, 2, 'a balanced four-leaf proof is two siblings')
  }
})

test('odd leaf counts still prove, with the promoted node carrying a shorter proof', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e'].map((x) => hashLeaf(h(x)))
  const tree = buildTree(leaves)

  for (const [i, leaf] of leaves.entries()) {
    assert.ok(verifyProof(leaf, tree.proofFor(i), tree.root), `leaf ${i} failed`)
  }
})

test('a single leaf is its own root', () => {
  const leaf = hashLeaf(h('only'))
  const tree = buildTree([leaf])
  assert.equal(tree.root, leaf)
  assert.deepEqual(tree.proofFor(0), [])
})

test('a tampered leaf does not verify', () => {
  const leaves = ['a', 'b', 'c', 'd'].map((x) => hashLeaf(h(x)))
  const tree = buildTree(leaves)
  assert.equal(verifyProof(hashLeaf(h('forged')), tree.proofFor(0), tree.root), false)
})

test('an internal node cannot be presented as a leaf', () => {
  // Domain separation is the point: without the prefix bytes, the hash of a
  // pair would be indistinguishable from the hash of a leaf, and an attacker
  // could claim an internal node was evidence that had been anchored.
  const leaves = ['a', 'b', 'c', 'd'].map((x) => hashLeaf(h(x)))
  const tree = buildTree(leaves)
  const internal = buildTree(leaves.slice(0, 2)).root

  assert.equal(verifyProof(internal, tree.proofFor(0), tree.root), false)
})

test('a different set of leaves gives a different root', () => {
  const original = buildTree(['a', 'b', 'c', 'd'].map((x) => hashLeaf(h(x)))).root
  const altered = buildTree(['a', 'b', 'c', 'X'].map((x) => hashLeaf(h(x)))).root
  assert.notEqual(original, altered)
})

test('sibling leaves commute, which is what sorted pairs buy us', () => {
  // Sorting each pair before hashing is why a proof needs no direction flags,
  // and the cost is that swapping two leaves under the same parent leaves the
  // root unchanged. That is acceptable here: a root commits to the *set* of
  // evidence anchored in a batch, and a proof establishes membership in that
  // set. Position within the batch carries no meaning and is never relied on.
  const forward = buildTree(['a', 'b', 'c', 'd'].map((x) => hashLeaf(h(x)))).root
  const swapped = buildTree(['b', 'a', 'c', 'd'].map((x) => hashLeaf(h(x)))).root
  assert.equal(forward, swapped)
})

test('rejects an empty tree rather than inventing a root', () => {
  assert.throws(() => buildTree([]), /no leaves/)
})
