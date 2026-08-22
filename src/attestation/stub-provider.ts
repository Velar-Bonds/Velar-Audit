import type { Attestation, CountryCode, Donation, SourceOfFunds } from '../types.js'
import { hashPayload, newId } from './hash.js'

/**
 * Stand-in for a real KYC / source-of-funds provider.
 *
 * The contract that matters is the boundary, not this implementation: the
 * provider holds the donor's identity, and hands us a pseudonymous ref plus a
 * hash. Swapping this for Sumsub or Truora is a change to this one file.
 */

export interface AttestationRequest {
  donation: Donation
  donorRef: string
  donorCountry: CountryCode
  sourceOfFunds: SourceOfFunds
  kycVerified: boolean
  isPep: boolean
}

const PROVIDER_ID = 'stub-kyc-provider'

export function issueAttestation(req: AttestationRequest): Attestation {
  const issuedAt = Date.now()

  /**
   * The payload the provider signs. It stays inside the provider boundary —
   * we keep only its hash and the non-identifying fields we are allowed to see.
   */
  const payload = {
    providerId: PROVIDER_ID,
    donationTxHash: req.donation.txHash,
    donorRef: req.donorRef,
    donorCountry: req.donorCountry,
    sourceOfFunds: req.sourceOfFunds,
    kycVerified: req.kycVerified,
    isPep: req.isPep,
    issuedAt,
  }

  return {
    id: newId('att'),
    donationId: req.donation.id,
    providerId: PROVIDER_ID,
    donorRef: req.donorRef,
    donorCountry: req.donorCountry,
    sourceOfFunds: req.sourceOfFunds,
    kycVerified: req.kycVerified,
    isPep: req.isPep,
    issuedAt,
    hash: hashPayload(payload),
  }
}

/**
 * Recompute the hash from the fields we retained, to prove an attestation has
 * not been edited after the fact. The TSE runs this against the on-chain anchor.
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
