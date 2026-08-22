import { createHash } from 'node:crypto'
import type { Attestation, CountryCode, Donation, SourceOfFunds } from '../types.js'
import { hashPayload, newId } from './hash.js'

/**
 * Stand-in for a KYC / source-of-funds provider.
 *
 * The contract that matters is the boundary, not this implementation: the
 * provider holds the donor's identity and hands back a pseudonymous reference
 * plus a hash. Swapping this for Sumsub or Truora is a change to this one file.
 *
 * Everything here is derived deterministically from the donation's transaction
 * hash, which is what lets the whole system be rebuilt from the chain alone.
 * A real provider gives the same answer when asked twice about the same
 * donation; so does this one, and that is the property the rebuild depends on.
 */

const PROVIDER_ID = 'stub-kyc-provider'

/**
 * Who the donor is derives from their address; whether the provider has
 * answered yet derives from the transaction.
 *
 * The split matters. A person's nationality does not change between two
 * donations, so deriving it per-transaction would produce a donor who is
 * Costa Rican on Monday and American on Tuesday — and would make the annual
 * cap meaningless, since it sums contributions per donor. Timing, on the other
 * hand, genuinely is per-donation: a provider can have cleared one transfer
 * and not yet the next.
 */
function identityBytes(address: string): Buffer {
  return createHash('sha256').update(`${PROVIDER_ID}:identity:${address.toLowerCase()}`).digest()
}

function timingBytes(txHash: string): Buffer {
  return createHash('sha256').update(`${PROVIDER_ID}:timing:${txHash}`).digest()
}

/** A byte from the derived entropy, as a 0–99 value. */
const pick = (bytes: Buffer, index: number) => bytes[index]! % 100

export interface AttestationInput {
  donation: Donation
  donorRef: string
  donorCountry: CountryCode
  sourceOfFunds: SourceOfFunds
  kycVerified: boolean
  isPep: boolean
  issuedAt: number
}

export function issueAttestation(input: AttestationInput): Attestation {
  /**
   * The payload the provider signs. It stays inside the provider boundary — we
   * keep only its hash and the non-identifying fields we are allowed to see.
   */
  const payload = {
    providerId: PROVIDER_ID,
    donationTxHash: input.donation.txHash,
    donorRef: input.donorRef,
    donorCountry: input.donorCountry,
    sourceOfFunds: input.sourceOfFunds,
    kycVerified: input.kycVerified,
    isPep: input.isPep,
    issuedAt: input.issuedAt,
  }

  return {
    id: newId('att'),
    donationId: input.donation.id,
    providerId: PROVIDER_ID,
    donorRef: input.donorRef,
    donorCountry: input.donorCountry,
    sourceOfFunds: input.sourceOfFunds,
    kycVerified: input.kycVerified,
    isPep: input.isPep,
    issuedAt: input.issuedAt,
    hash: hashPayload(payload),
  }
}

const SOURCES: SourceOfFunds[] = ['salary', 'business_income', 'savings']

/**
 * Ask the provider about a donation.
 *
 * Returns null when the provider has not issued an attestation yet — the
 * `pending` case, which ages into a violation if the cure window passes.
 */
export interface DonorIdentity {
  donorRef: string
  donorCountry: CountryCode
  sourceOfFunds: SourceOfFunds
  kycVerified: boolean
  isPep: boolean
}

/**
 * What the provider knows about whoever controls an address.
 *
 * Exported so the seeding script can look ahead: it derives a range of donor
 * accounts, reads what each would resolve to, and picks the ones that produce
 * the scenario being demonstrated. Choosing which donors take part is a
 * legitimate thing for a seeding script to do — inventing their attestations
 * would not be.
 */
export function identityFor(address: string): DonorIdentity {
  const bytes = identityBytes(address)
  const foreign = pick(bytes, 1) < 22
  const undisclosed = pick(bytes, 2) < 8
  const kycFailed = pick(bytes, 3) < 6

  return {
    // Pseudonymous and stable: the same address always maps to the same
    // reference, which is what lets contributions be summed against the cap
    // without anyone learning who the donor is.
    donorRef: `donor-${createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 10)}`,
    donorCountry: foreign ? (pick(bytes, 4) < 50 ? 'US' : 'PA') : 'CR',
    sourceOfFunds: undisclosed ? 'undisclosed' : SOURCES[bytes[5]! % SOURCES.length]!,
    kycVerified: !kycFailed,
    isPep: pick(bytes, 6) < 12,
  }
}

export function requestAttestation(donation: Donation): Attestation | null {
  // Not cleared yet. Roughly one donation in twelve.
  if (pick(timingBytes(donation.txHash), 0) < 8) return null

  return issueAttestation({
    donation,
    ...identityFor(donation.fromAddress),
    // Taken from the block, not from the clock: replaying the chain must
    // produce the same attestation hash it produced the first time.
    issuedAt: donation.receivedAt,
  })
}

/**
 * Recompute the hash from the fields we retained, to prove an attestation has
 * not been edited after the fact. The tribunal runs this against the anchor.
 */
export function verifyAttestation(att: Attestation, donation: Donation): boolean {
  const payload = {
    providerId: att.providerId,
    donationTxHash: donation.txHash,
    donorRef: att.donorRef,
    donorCountry: att.donorCountry,
    sourceOfFunds: att.sourceOfFunds,
    kycVerified: att.kycVerified,
    isPep: att.isPep,
    issuedAt: att.issuedAt,
  }
  return hashPayload(payload) === att.hash
}
